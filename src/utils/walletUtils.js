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

export const transferADAAndTokens = async (
  walletApi,
  cardanoWasm,
  receiverAddress,
  tokenPolicyIds,  // Array of policy IDs
  tokenAssetNames,  // Array of asset names
  tokenAmounts  // Array of token amounts to transfer (4/5 for each token)
) => {
  try {
    console.log("Starting ADA and token transfer...");

    // Step 1: Define the minimum ADA (2 ADA in Lovelace)
    const minAdaAmount = 1.99 * 1_000_000;  // 2 ADA in Lovelace
    const adaInLovelace = cardanoWasm.BigNum.from_str(minAdaAmount.toString());
    console.log("Minimum ADA in Lovelace:", adaInLovelace.to_str());

    // Step 2: Fetch protocol parameters for fee calculations
    const protocolParameters = await fetchProtocolParams();
    console.log("Protocol Parameters:", protocolParameters);

    // Step 3: Get the wallet's change address (the address for leftover UTXO)
    const walletChangeAddress = await walletApi.getChangeAddress();
    console.log("Change Address:", walletChangeAddress);

    const changeAddr = walletChangeAddress.startsWith("addr1")
      ? cardanoWasm.Address.from_bech32(walletChangeAddress)
      : cardanoWasm.Address.from_bytes(Buffer.from(walletChangeAddress, "hex"));
    const receiverAddr = cardanoWasm.Address.from_bech32(receiverAddress);
    console.log("Receiver Address:", receiverAddress);

    // Step 4: Set up the TransactionBuilder with protocol parameters
    const txBuilder = cardanoWasm.TransactionBuilder.new(
      cardanoWasm.TransactionBuilderConfigBuilder.new()
        .fee_algo(
          cardanoWasm.LinearFee.new(
            cardanoWasm.BigNum.from_str(protocolParameters.min_fee_a.toString()),
            cardanoWasm.BigNum.from_str(protocolParameters.min_fee_b.toString())
          )
        )
        .pool_deposit(cardanoWasm.BigNum.from_str(protocolParameters.pool_deposit.toString()))
        .key_deposit(cardanoWasm.BigNum.from_str(protocolParameters.key_deposit.toString()))
        .coins_per_utxo_word(cardanoWasm.BigNum.from_str(protocolParameters.coins_per_utxo_word.toString()))
        .max_tx_size(protocolParameters.max_tx_size)
        .max_value_size(5000)
        .build()
    );
    console.log("Transaction Builder initialized");

    // Step 5: Multi-Asset (tokens) setup
    const multiAsset = cardanoWasm.MultiAsset.new();
    try {
      for (let i = 0; i < tokenPolicyIds.length; i++) {
        const tokenPolicyId = tokenPolicyIds[i];
        const tokenAssetName = tokenAssetNames[i];
        const tokenAmount = tokenAmounts[i];  // Transfer 4/5 of the token

        // Convert asset name to hex if necessary
        const assetNameHex = /^[0-9a-fA-F]+$/.test(tokenAssetName)
          ? tokenAssetName
          : Buffer.from(tokenAssetName, "utf8").toString("hex");

        // Prepare the asset for transfer
        const assetName = cardanoWasm.AssetName.new(Buffer.from(assetNameHex, "hex"));
        const scriptHash = cardanoWasm.ScriptHash.from_bytes(Buffer.from(tokenPolicyId, "hex"));
        const assetValue = cardanoWasm.BigNum.from_str(tokenAmount.toString());

        let assets = cardanoWasm.Assets.new();
        assets.insert(assetName, assetValue);
        multiAsset.insert(scriptHash, assets);
        console.log(`Asset added - Policy ID: ${tokenPolicyId}, Asset Name: ${assetNameHex}, Amount: ${tokenAmount}`);
      }
    } catch (error) {
      console.error("Error processing tokens:", error);
      throw error;
    }

    // Step 6: Create the output value (2 ADA + tokens)
    const outputValue = cardanoWasm.Value.new(adaInLovelace);
    outputValue.set_multiasset(multiAsset);
    console.log("Output Value (ADA + Tokens) set up");

    // Step 7: Add output (2 ADA + tokens) to the transaction builder
    txBuilder.add_output(cardanoWasm.TransactionOutput.new(receiverAddr, outputValue));
    console.log("Transaction Output added");

    // Step 8: Fetch UTXOs from the wallet to cover the transaction inputs
    let utxosHex;
    try {
      utxosHex = await walletApi.getUtxos();
      if (!utxosHex || utxosHex.length === 0) {
        throw new Error("No UTXOs found in the wallet.");
      }
      console.log("UTXOs fetched:", utxosHex);
    } catch (error) {
      console.error("Error fetching UTXOs:", error);
      throw error;
    }

    const utxos = utxosHex.map((utxoHex) =>
      cardanoWasm.TransactionUnspentOutput.from_bytes(Buffer.from(utxoHex, "hex"))
    );

    let adaCollected = cardanoWasm.BigNum.from_str("0");
    let totalInputValue = cardanoWasm.Value.new(cardanoWasm.BigNum.from_str("0"));

   // Step 9: Add inputs to the transaction builder until sufficient ADA and tokens are collected
try {
  for (const utxo of utxos) {
    const inputValue = utxo.output().amount();
    
    // Log ADA value
    console.log("Input value (ADA in Lovelace):", inputValue.coin().to_str());

    // Log any multi-asset (tokens) if present
    const multiAsset = inputValue.multiasset();
    if (multiAsset) {
      console.log("Multi-asset (tokens) present in UTXO:");
      const assetPolicies = multiAsset.keys();
      for (let j = 0; j < assetPolicies.len(); j++) {
        const policyId = assetPolicies.get(j);
        const assets = multiAsset.get(policyId);
        const assetNames = assets.keys();
        for (let k = 0; k < assetNames.len(); k++) {
          const assetName = assetNames.get(k);
          const amount = assets.get(assetName).to_str();
          console.log(`Token - Policy ID: ${Buffer.from(policyId.to_bytes()).toString('hex')}, Asset Name: ${Buffer.from(assetName.name()).toString()}, Amount: ${amount}`);
        }
      }
    }

    // Collect ADA
    adaCollected = adaCollected.checked_add(inputValue.coin());
    totalInputValue = totalInputValue.checked_add(inputValue);

    // Add UTXO input to the transaction
    txBuilder.add_input(changeAddr, utxo.input(), inputValue);
    console.log("UTXO added, ADA collected:", adaCollected.to_str());

    // Stop once we have enough ADA to cover the transaction (min ADA + fee)
    if (adaCollected.compare(adaInLovelace) >= 0) {
      break;
    }
  }
} catch (error) {
  console.error("Error adding UTXOs as inputs:", error);
  throw error;
}


    // Step 10: Set the transaction fee
    const fee = txBuilder.min_fee();
    txBuilder.set_fee(fee);
    console.log("Transaction fee set:", fee.to_str());

    // Step 11: Calculate total required ADA (output ADA + fee)
    const totalRequiredAda = adaInLovelace.checked_add(fee);
    console.log("Total required ADA:", totalRequiredAda.to_str());

    // Step 12: Check if inputs cover outputs and fee, else throw an error
    if (adaCollected.compare(totalRequiredAda) < 0) {
      throw new Error("Insufficient ADA to cover transaction outputs and fee.");
    }

    // Step 13: Calculate the change value (leftover ADA)
    const changeValue = adaCollected.checked_sub(totalRequiredAda);
    if (!changeValue.is_zero()) {
      // Add the leftover ADA as change to the wallet
      txBuilder.add_output(cardanoWasm.TransactionOutput.new(changeAddr, cardanoWasm.Value.new(changeValue)));
      console.log("Change value added:", changeValue.to_str());
    }

    // Step 14: Build the transaction body
    const txBody = txBuilder.build();
    console.log("Transaction body built");

    // Step 15: Sign the transaction
    try {
      const signedTxHex = await walletApi.signTx(
        Buffer.from(txBody.to_bytes()).toString("hex"),
        true
      );
      const signedTx = cardanoWasm.Transaction.new(
        txBody,
        cardanoWasm.TransactionWitnessSet.from_bytes(Buffer.from(signedTxHex, "hex"))
      );
      console.log("Transaction signed successfully");

      // Step 16: Submit the transaction
      try {
        const txHash = await walletApi.submitTx(
          Buffer.from(signedTx.to_bytes()).toString("hex")
        );
        console.log("Transaction submitted successfully, txHash:", txHash);

        // Return the transaction hash as confirmation
        return txHash;
      } catch (error) {
        console.error("Error submitting the transaction:", error);
        throw error;
      }
    } catch (error) {
      console.error("Error signing the transaction:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error during ADA and token transfer:", error);
    throw error;
  }
};

