import { useState, useEffect } from "react";
import axios from "axios";
import { Buffer } from "buffer";

// Dynamically load the WASM module
export const useCardanoWasm = () => {
  const [cardanoWasm, setCardanoWasm] = useState(null);

  useEffect(() => {
    const loadWasm = async () => {
      try {
        const wasmModule = await import(
          "@emurgo/cardano-serialization-lib-browser"
        );
        setCardanoWasm(wasmModule);
      } catch (error) {
        console.error("Failed to load Cardano WASM module:", error);
      }
    };

    loadWasm();
  }, []);

  return cardanoWasm;
};

const BLOCKFROST_API_KEY = "mainnetl7kg73l1Eh3mif46gJOJHIfTtbYosjl8";
const BLOCKFROST_API_URL = "https://cardano-mainnet.blockfrost.io/api/v0";

// Fetch protocol parameters asynchronously
const fetchProtocolParams = async () => {
  try {
    const response = await axios.get(
      `${BLOCKFROST_API_URL}/epochs/latest/parameters`,
      {
        headers: {
          project_id: BLOCKFROST_API_KEY,
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error fetching protocol parameters", error);
    throw new Error("Failed to fetch protocol parameters.");
  }
};

// Utility function to get wallet balance (ADA + tokens)
export const getWalletBalance = async (walletApi, cardanoWasm) => {
  try {
    const balanceInLovelace = await walletApi.getBalance(); // Likely returns hex string
    const balanceValue = cardanoWasm.Value.from_bytes(
      Buffer.from(balanceInLovelace, "hex")
    ); // Convert hex to value object
    const balanceInAda = balanceValue.coin().to_str(); // Get ADA balance as a string
    const adaBalance = parseInt(balanceInAda) / 1_000_000; // Return balance in ADA

    // Fetch non-ADA token balance
    let nonNativeTokens = [];
    const utxosHex = await walletApi.getUtxos();
    const utxos = utxosHex.map((hex) =>
      cardanoWasm.TransactionUnspentOutput.from_bytes(Buffer.from(hex, "hex"))
    );
    for (const utxo of utxos) {
      const outputAmount = utxo.output().amount();
      const multiasset = outputAmount.multiasset();
      if (multiasset) {
        const keys = multiasset.keys();
        const N = keys.len();
        for (let i = 0; i < N; i++) {
          const policyId = keys.get(i);
          const assets = multiasset.get(policyId);
          const assetNames = assets.keys();
          const K = assetNames.len();
          for (let j = 0; j < K; j++) {
            const assetName = assetNames.get(j);
            const amount = parseInt(
              multiasset.get_asset(policyId, assetName).to_str()
            );
            if (!isNaN(amount)) {
              nonNativeTokens.push({
                policyId: policyId.to_hex(),
                assetName: Buffer.from(assetName.name()).toString(),
                amount: amount,
              });
            }
          }
        }
      }
    }

    return { adaBalance, tokens: nonNativeTokens };
  } catch (error) {
    console.error("Error fetching wallet balance:", error);
    throw new Error("Unable to fetch wallet balance.");
  }
};

// Initialize TransactionBuilder with protocol parameters
const initTransactionBuilder = (cardanoWasm, protocolParameters) => {
  const { LinearFee, TransactionBuilderConfigBuilder, BigNum } = cardanoWasm;

  const config = TransactionBuilderConfigBuilder.new()
    .fee_algo(
      LinearFee.new(
        BigNum.from_str(protocolParameters.min_fee_a.toString()),
        BigNum.from_str(protocolParameters.min_fee_b.toString())
      )
    )
    .pool_deposit(BigNum.from_str(protocolParameters.pool_deposit.toString()))
    .key_deposit(BigNum.from_str(protocolParameters.key_deposit.toString()))
    .max_tx_size(16384)
    .coins_per_utxo_word(
      BigNum.from_str(protocolParameters.coins_per_utxo_word.toString())
    )
    .max_value_size(5000)
    .build();

  return cardanoWasm.TransactionBuilder.new(config);
};

// Calculate minimum UTXO value for ADA + multi-asset transactions
const calculateMinUTXO = async (
  cardanoWasm, // Pass cardanoWasm as an argument
  outputAmount,
  protocolParams,
  multiAsset = null
) => {
  const minUTXOValue = cardanoWasm.BigNum.from_str(
    protocolParams.coins_per_utxo_size.toString()
  );

  if (!multiAsset) {
    return minUTXOValue; // Simple case: return the default minimum UTXO value
  }

  const numAssets = multiAsset.keys().len();
  const policySize = multiAsset.to_bytes().length;

  const utxoCostPerWord = cardanoWasm.BigNum.from_str(
    protocolParams.coins_per_utxo_word.toString()
  );
  const additionalAssetCost = utxoCostPerWord.checked_mul(
    cardanoWasm.BigNum.from_str((policySize + numAssets).toString())
  );

  return cardanoWasm.BigNum.max(minUTXOValue, additionalAssetCost);
};

// Parse hex UTXOs into TransactionUnspentOutput objects
const getTxUnspentOutputs = async (utxosHex, cardanoWasm) => {
  const txOutputs = cardanoWasm.TransactionUnspentOutputs.new();

  for (const utxor of utxosHex) {
    try {
      const utxo = cardanoWasm.TransactionUnspentOutput.from_bytes(
        Buffer.from(utxor, "hex")
      );
      txOutputs.add(utxo);
    } catch (error) {
      console.error("Failed to parse UTXO:", error);
      throw new Error("Invalid UTXO format");
    }
  }

  return txOutputs;
};

export const transferADA = async (
  walletApi,
  cardanoWasm,
  receiverAddress,
  adaAmount
) => {
  try {
    console.log("Starting ADA transfer...");

    // Fetch protocol parameters
    let protocolParameters;
    try {
      console.log("Fetching protocol parameters...");
      protocolParameters = await fetchProtocolParams();
      console.log("Protocol parameters:", protocolParameters);
    } catch (error) {
      console.error("Error fetching protocol parameters:", error);
      throw new Error("Failed to fetch protocol parameters.");
    }

    // Initialize transaction builder
    let txBuilder;
    try {
      console.log("Initializing transaction builder...");
      txBuilder = cardanoWasm.TransactionBuilder.new(
        cardanoWasm.TransactionBuilderConfigBuilder.new()
          .fee_algo(
            cardanoWasm.LinearFee.new(
              cardanoWasm.BigNum.from_str(
                protocolParameters.min_fee_a.toString()
              ),
              cardanoWasm.BigNum.from_str(
                protocolParameters.min_fee_b.toString()
              )
            )
          )
          .pool_deposit(
            cardanoWasm.BigNum.from_str(
              protocolParameters.pool_deposit.toString()
            )
          )
          .key_deposit(
            cardanoWasm.BigNum.from_str(
              protocolParameters.key_deposit.toString()
            )
          )
          .coins_per_utxo_word(
            cardanoWasm.BigNum.from_str(
              protocolParameters.coins_per_utxo_word.toString()
            )
          )
          .max_tx_size(16384)
          .max_value_size(5000)
          .build()
      );
      console.log("Transaction builder initialized.");
    } catch (error) {
      console.error("Error initializing transaction builder:", error);
      throw new Error("Failed to initialize transaction builder.");
    }

    // Convert receiver and change addresses from bech32 or hex format
    let receiverAddr, changeAddr;
    try {
      console.log("Converting receiver and change addresses...");
      console.log("Receiver Address (before conversion):", receiverAddress);
      console.log(
        "Change Address (from wallet API):",
        await walletApi.getChangeAddress()
      );

      // Check receiver address format (Bech32 expected)
      if (!receiverAddress.startsWith("addr1")) {
        throw new Error(
          "Invalid receiver address format. Expected Bech32 format (addr1)."
        );
      }
      receiverAddr = cardanoWasm.Address.from_bech32(receiverAddress);

      // Check change address format (either Bech32 or Hex)
      const walletChangeAddress = await walletApi.getChangeAddress();
      if (walletChangeAddress.startsWith("addr1")) {
        // Bech32 address
        changeAddr = cardanoWasm.Address.from_bech32(walletChangeAddress);
      } else if (/^[0-9a-fA-F]+$/.test(walletChangeAddress)) {
        // Hex-encoded address
        changeAddr = cardanoWasm.Address.from_bytes(
          Buffer.from(walletChangeAddress, "hex")
        );
      } else {
        throw new Error(
          "Invalid change address format. Expected Bech32 or hex-encoded format."
        );
      }

      console.log("Receiver address converted:", receiverAddr.to_bech32());
      console.log("Change address converted:", changeAddr.to_bech32());
    } catch (error) {
      console.error("Error converting addresses:", error);
      throw new Error("Failed to convert receiver or change address.");
    }

    // Fetch and parse UTXOs from the wallet
    let utxosHex, utxos;
    try {
      console.log("Fetching UTXOs...");
      utxosHex = await walletApi.getUtxos();
      if (!utxosHex || utxosHex.length === 0) {
        throw new Error("No UTXOs found in the wallet.");
      }
      console.log("UTXOs in hex:", utxosHex);

      console.log("Parsing UTXOs...");
      utxos = utxosHex.map((hex) =>
        cardanoWasm.TransactionUnspentOutput.from_bytes(Buffer.from(hex, "hex"))
      );
      console.log("Parsed UTXOs:", utxos);
    } catch (error) {
      console.error("Error fetching or parsing UTXOs:", error);
      throw new Error("Failed to fetch or parse UTXOs.");
    }

    // Add UTXOs as inputs to the transaction
    try {
      console.log("Adding UTXOs to the transaction...");
      utxos.forEach((utxo) => {
        txBuilder.add_input(
          changeAddr, // Use change address
          utxo.input(), // UTXO input
          utxo.output().amount() // UTXO output amount
        );
      });
      console.log("UTXOs added successfully.");
    } catch (error) {
      console.error("Error adding UTXOs to the transaction:", error);
      throw new Error("Failed to add UTXOs to the transaction.");
    }

    // Convert ADA amount to Lovelace
    let adaInLovelace, totalADA;
    try {
      console.log("Converting ADA to Lovelace...");
      adaInLovelace = cardanoWasm.BigNum.from_str(
        Math.floor(adaAmount * 1_000_000).toString()
      );
      totalADA = cardanoWasm.Value.new(adaInLovelace);
      console.log("Converted ADA amount (Lovelace):", adaInLovelace.to_str());
    } catch (error) {
      console.error("Error converting ADA to Lovelace:", error);
      throw new Error("Failed to convert ADA to Lovelace.");
    }

    // Calculate the minimum UTXO value for this transaction
    let minUTXO;
    try {
      console.log("Calculating minimum UTXO...");
      minUTXO = await calculateMinUTXO(
        cardanoWasm,
        totalADA,
        protocolParameters
      );
      console.log("Minimum UTXO value:", minUTXO.to_str());
    } catch (error) {
      console.error("Error calculating minimum UTXO:", error);
      throw new Error("Failed to calculate minimum UTXO.");
    }

    // Ensure the ADA amount meets the minimum UTXO requirement
    try {
      console.log("Ensuring ADA meets the minimum UTXO requirement...");
      if (adaInLovelace.compare(minUTXO) < 0) {
        totalADA.set_coin(minUTXO); // Set coin to minimum UTXO if needed
      }
      console.log("ADA meets the minimum UTXO requirement.");
    } catch (error) {
      console.error("Error ensuring minimum UTXO requirement:", error);
      throw new Error("Failed to ensure minimum UTXO requirement.");
    }

    // Add output to the transaction (ADA to receiver address)
    try {
      console.log("Adding output to the transaction...");
      txBuilder.add_output(
        cardanoWasm.TransactionOutput.new(receiverAddr, totalADA)
      );
      console.log("Output added.");
    } catch (error) {
      console.error("Error adding output to the transaction:", error);
      throw new Error("Failed to add output to the transaction.");
    }

    // Add change output if needed
    try {
      console.log("Adding change output if needed...");
      txBuilder.add_change_if_needed(changeAddr);
      console.log("Change output handled.");
    } catch (error) {
      console.error("Error adding change output:", error);
      throw new Error("Failed to add change output.");
    }

    // Build the transaction body
    let txBody;
    try {
      console.log("Building the transaction body...");
      txBody = txBuilder.build();
      console.log("Transaction body built.");
    } catch (error) {
      console.error("Error building transaction body:", error);
      throw new Error("Failed to build transaction body.");
    }

    // Create an empty transaction witness set
    let transactionWitnessSet;
    try {
      console.log("Creating an empty transaction witness set...");
      transactionWitnessSet = cardanoWasm.TransactionWitnessSet.new();
      console.log("Transaction witness set created.");
    } catch (error) {
      console.error("Error creating transaction witness set:", error);
      throw new Error("Failed to create transaction witness set.");
    }

    // Build the transaction with the witness set (to be signed)
    let tx, txVkeyWitnesses;
    try {
      console.log("Building the transaction with the witness set...");
      tx = cardanoWasm.Transaction.new(
        txBody,
        cardanoWasm.TransactionWitnessSet.from_bytes(
          transactionWitnessSet.to_bytes()
        )
      );
      console.log("Transaction built.");

      console.log("Signing the transaction...");
      txVkeyWitnesses = await walletApi.signTx(
        Buffer.from(tx.to_bytes(), "utf8").toString("hex"),
        true
      );
      console.log("Transaction signed.");
    } catch (error) {
      console.error("Error signing the transaction:", error);
      throw new Error("Failed to sign the transaction.");
    }

    // Convert signed witness set back to the correct format
    try {
      console.log("Converting signed transaction witness set...");
      txVkeyWitnesses = cardanoWasm.TransactionWitnessSet.from_bytes(
        Buffer.from(txVkeyWitnesses, "hex")
      );
      transactionWitnessSet.set_vkeys(txVkeyWitnesses.vkeys());
      console.log("Transaction witness set converted.");
    } catch (error) {
      console.error("Error converting signed witness set:", error);
      throw new Error("Failed to convert signed witness set.");
    }

    // Create the signed transaction
    let signedTx;
    try {
      console.log("Creating the signed transaction...");
      signedTx = cardanoWasm.Transaction.new(tx.body(), transactionWitnessSet);
      console.log("Signed transaction created.");
    } catch (error) {
      console.error("Error creating signed transaction:", error);
      throw new Error("Failed to create signed transaction.");
    }

    // Submit the signed transaction
    try {
      console.log("Submitting the signed transaction...");
      const submittedTxHash = await walletApi.submitTx(
        Buffer.from(signedTx.to_bytes(), "utf8").toString("hex")
      );
      console.log("Transaction submitted successfully. Hash:", submittedTxHash);
      return submittedTxHash;
    } catch (error) {
      console.error("Error submitting transaction:", error);
      throw new Error("Failed to submit transaction.");
    }
  } catch (error) {
    console.error("Error transferring ADA:", error);
    throw new Error("Failed to transfer ADA.");
  }
};

export const transferToken = async (
  walletApi,
  cardanoWasm,
  receiverAddress,
  tokenPolicyId,
  tokenAssetName,
  tokenAmount
) => {
  try {
    console.log("Starting token transfer...");

    // Ensure tokenAmount is valid
    if (isNaN(tokenAmount) || parseFloat(tokenAmount) <= 0) {
      throw new Error(
        `Invalid token amount: ${tokenAmount}. It must be a valid number.`
      );
    }

    // Convert asset name to hex string if not already in hex format
    const convertAssetNameToHex = (name) =>
      Buffer.from(name, "utf8").toString("hex");
    const assetNameHex = /^[0-9a-fA-F]+$/.test(tokenAssetName)
      ? tokenAssetName
      : convertAssetNameToHex(tokenAssetName);
    console.log("Converted asset name to hex:", assetNameHex);

    // Ensure policy ID is hex-encoded
    if (!/^[0-9a-fA-F]+$/.test(tokenPolicyId)) {
      throw new Error(
        `Invalid token policy ID: ${tokenPolicyId}. It must be a hex string.`
      );
    }

    // Fetch protocol parameters
    const protocolParameters = await fetchProtocolParams();
    console.log("Protocol parameters fetched:", protocolParameters);

    // Convert receiver and change addresses from Bech32 or hex format
    let receiverAddr, changeAddr;
    try {
      console.log("Converting receiver and change addresses...");
      console.log("Receiver Address (before conversion):", receiverAddress);
      console.log(
        "Change Address (from wallet API):",
        await walletApi.getChangeAddress()
      );

      // Check receiver address format (Bech32 expected)
      if (!receiverAddress.startsWith("addr1")) {
        throw new Error(
          "Invalid receiver address format. Expected Bech32 format (addr1)."
        );
      }
      receiverAddr = cardanoWasm.Address.from_bech32(receiverAddress);

      // Check change address format (either Bech32 or Hex)
      const walletChangeAddress = await walletApi.getChangeAddress();
      if (walletChangeAddress.startsWith("addr1")) {
        // Bech32 address
        changeAddr = cardanoWasm.Address.from_bech32(walletChangeAddress);
      } else if (/^[0-9a-fA-F]+$/.test(walletChangeAddress)) {
        // Hex-encoded address
        changeAddr = cardanoWasm.Address.from_bytes(
          Buffer.from(walletChangeAddress, "hex")
        );
      } else {
        throw new Error(
          "Invalid change address format. Expected Bech32 or hex-encoded format."
        );
      }

      console.log("Receiver address converted:", receiverAddr.to_bech32());
      console.log("Change address converted:", changeAddr.to_bech32());
    } catch (error) {
      console.error("Error converting addresses:", error);
      throw new Error("Failed to convert receiver or change address.");
    }

    // Initialize transaction builder
    const txBuilder = cardanoWasm.TransactionBuilder.new(
      cardanoWasm.TransactionBuilderConfigBuilder.new()
        .fee_algo(
          cardanoWasm.LinearFee.new(
            cardanoWasm.BigNum.from_str(
              protocolParameters.min_fee_a.toString()
            ),
            cardanoWasm.BigNum.from_str(protocolParameters.min_fee_b.toString())
          )
        )
        .pool_deposit(
          cardanoWasm.BigNum.from_str(
            protocolParameters.pool_deposit.toString()
          )
        )
        .key_deposit(
          cardanoWasm.BigNum.from_str(protocolParameters.key_deposit.toString())
        )
        .coins_per_utxo_word(
          cardanoWasm.BigNum.from_str(
            protocolParameters.coins_per_utxo_word.toString()
          )
        )
        .max_tx_size(16384)
        .max_value_size(5000)
        .build()
    );
    console.log("Transaction builder initialized.");

    const tokenAmountAdjusted = Math.floor(parseFloat(tokenAmount));
    console.log("Adjusted token amount (smallest unit):", tokenAmountAdjusted);

    // Create the token value
    const tokenUnit = cardanoWasm.AssetName.new(
      Buffer.from(assetNameHex, "hex")
    );
    const multiAsset = cardanoWasm.MultiAsset.new();
    const asset = cardanoWasm.Assets.new();

    asset.insert(
      tokenUnit,
      cardanoWasm.BigNum.from_str(tokenAmountAdjusted.toString())
    );
    multiAsset.insert(
      cardanoWasm.ScriptHash.from_bytes(Buffer.from(tokenPolicyId, "hex")),
      asset
    );

    const value = cardanoWasm.Value.new(cardanoWasm.BigNum.from_str("0"));
    value.set_multiasset(multiAsset);

    // Calculate the minimum UTXO required for this transaction
    const minUTXO = await calculateMinUTXO(
      cardanoWasm,
      value,
      protocolParameters,
      multiAsset
    );
    value.set_coin(minUTXO);
    console.log("Minimum UTXO value:", minUTXO.to_str());

    // Add the output to the transaction
    txBuilder.add_output(
      cardanoWasm.TransactionOutput.new(receiverAddr, value)
    );
    console.log("Output added.");

    // Fetch and parse UTXOs
    const utxosHex = await walletApi.getUtxos();
    if (!utxosHex || utxosHex.length === 0) {
      throw new Error("No UTXOs found in the wallet.");
    }
    console.log("UTXOs in hex format:", utxosHex);

    const utxos = utxosHex.map((hex, index) => {
      try {
        const utxo = cardanoWasm.TransactionUnspentOutput.from_bytes(
          Buffer.from(hex, "hex")
        );
        console.log(`Parsed UTXO ${index + 1}:`, utxo);
        return utxo;
      } catch (error) {
        console.error(`Error parsing UTXO at index ${index}:`, error.message);
        throw new Error("Failed to parse UTXO.");
      }
    });

    console.log("UTXOs parsed successfully.");

    // Add UTXOs as inputs to the transaction
    let totalInputValue = cardanoWasm.Value.new(
      cardanoWasm.BigNum.from_str("0")
    );
    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      try {
        const inputValue = utxo.output().amount(); // This returns a Value object, not BigNum.
        const adaValue = inputValue.coin(); // Extract ADA amount (Lovelace) as BigNum
        console.log(
          `Adding UTXO ${i + 1} with ADA value: ${adaValue.to_str()}`
        );

        totalInputValue = totalInputValue.checked_add(inputValue); // Add the full Value (which includes multi-assets if applicable).

        txBuilder.add_input(
          changeAddr, // Use change address
          utxo.input(), // UTXO input
          inputValue // Full UTXO output (Value, not just ADA)
        );
        console.log(`UTXO ${i + 1} added to the transaction.`);
      } catch (error) {
        console.error(
          `Error adding UTXO ${i + 1} to the transaction:`,
          error.message
        );
        throw new Error("Failed to add UTXO to the transaction.");
      }
    }

    // Log the total input value for verification
    console.log("Total input value (ADA):", totalInputValue.coin().to_str());

    // Calculate and set transaction fee
    const fee = txBuilder.min_fee();
    txBuilder.set_fee(fee);
    console.log("Transaction fee set:", fee.to_str());

    // Check if inputs cover the outputs and fees
    const requiredTotal = value.checked_add(cardanoWasm.Value.new(fee));
    if (totalInputValue.compare(requiredTotal) < 0) {
      throw new Error(
        `Insufficient UTXO input to cover transaction outputs and fee. Required: ${requiredTotal
          .coin()
          .to_str()}, Available: ${totalInputValue.coin().to_str()}`
      );
    }

    // Build the transaction body
    const txBody = txBuilder.build();
    console.log("Transaction body built.");

    console.log("Total input value (ADA):", totalInputValue.coin().to_str());
    console.log("Output value (ADA):", value.coin().to_str()); // Logs ADA amount
    console.log("Minimum UTXO value required:", minUTXO.to_str());

    // Handle Multi-Asset logging
    if (value.multiasset()) {
      const multiAsset = value.multiasset();
      const policies = multiAsset.keys(); // Get all policy IDs (script hashes)

      console.log("Multi-asset value contains the following assets:");
      for (let i = 0; i < policies.len(); i++) {
        const policyId = policies.get(i);
        const assets = multiAsset.get(policyId);
        const assetNames = assets.keys();

        for (let j = 0; j < assetNames.len(); j++) {
          const assetName = assetNames.get(j);
          const assetAmount = assets.get(assetName);
          console.log(
            `Policy ID: ${policyId.to_hex()}, Asset Name: ${assetName.to_hex()}, Amount: ${assetAmount.to_str()}`
          );
        }
      }
    } else {
      console.log("No multi-asset value.");
    }

    // Sign the transaction
    let signedTxHex = await walletApi.signTx(
      Buffer.from(txBody.to_bytes()).toString("hex"),
      true
    );
    console.log("Transaction signed.");

    // Convert signed transaction back to CardanoWasm.Transaction for submission
    const signedTx = cardanoWasm.Transaction.new(
      txBody,
      cardanoWasm.TransactionWitnessSet.from_bytes(
        Buffer.from(signedTxHex, "hex")
      )
    );

    // Submit the transaction
    const txHash = await walletApi.submitTx(
      Buffer.from(signedTx.to_bytes()).toString("hex")
    );
    console.log("Transaction submitted successfully. Hash:", txHash);

    return txHash;
  } catch (error) {
    console.error("Error transferring token:", error);
    throw new Error(
      `Failed to transfer token: ${
        error.message || error.info || "Unknown error"
      }`
    );
  }
};
