import { useState, useEffect } from "react";
import axios from "axios";
import { Buffer } from "buffer"; // Necessary for converting data

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
    .max_tx_size(protocolParameters.max_tx_size)
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

// Transfer ADA with proper UTXO selection
export const transferADA = async (
  walletApi,
  cardanoWasm,
  receiverAddress,
  adaAmount
) => {
  try {
    const protocolParameters = await fetchProtocolParams();
    const { TransactionOutput, Value, Address, BigNum } = cardanoWasm;

    const txBuilder = initTransactionBuilder(cardanoWasm, protocolParameters);

    // Convert ADA to Lovelace
    const lovelaceAmount = Math.floor(adaAmount * 1_000_000); // ADA to Lovelace conversion

    // Ensure receiver and change address are properly formatted
    const receiverAddr = Address.from_bech32(receiverAddress);
    const changeAddr = Address.from_bech32(await walletApi.getChangeAddress());

    const value = Value.new(BigNum.from_str(lovelaceAmount.toString()));
    txBuilder.add_output(TransactionOutput.new(receiverAddr, value));

    // Fetch and parse UTXOs
    const utxosHex = await walletApi.getUtxos();
    const utxos = utxosHex.map((hex) =>
      cardanoWasm.TransactionUnspentOutput.from_bytes(Buffer.from(hex, "hex"))
    );

    let totalInput = BigNum.zero();

    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      const outputValue = utxo.output().amount().coin();
      txBuilder.add_input(changeAddr, utxo.input(), utxo.output().amount());

      totalInput = totalInput.checked_add(outputValue);

      const estimatedFee = txBuilder.min_fee();
      const totalRequired = BigNum.from_str(
        (lovelaceAmount + parseInt(estimatedFee.to_str())).toString()
      );

      if (totalInput.compare(totalRequired) >= 0) {
        break;
      }
    }

    if (totalInput.compare(BigNum.from_str(lovelaceAmount.toString())) < 0) {
      throw new Error("Insufficient UTXO balance to cover the ADA transfer.");
    }

    txBuilder.add_change_if_needed(changeAddr);

    if (txBuilder.build().size() > protocolParameters.max_value_size) {
      throw new Error(
        `Transaction exceeds the maximum allowed value size of ${protocolParameters.max_value_size}.`
      );
    }

    const fee = txBuilder.min_fee();
    txBuilder.set_fee(fee);

    const txBody = txBuilder.build();
    const signedTx = await walletApi.signTx(txBody, true);
    const txHash = await walletApi.submitTx(signedTx);

    return txHash;
  } catch (error) {
    console.error("Error transferring ADA:", error);
    throw new Error("Failed to transfer ADA.");
  }
};

// Transfer Token with proper UTXO selection
export const transferToken = async (
  walletApi,
  cardanoWasm,
  receiverAddress,
  tokenPolicyId,
  tokenAssetName,
  tokenAmount
) => {
  try {
    const protocolParameters = await fetchProtocolParams();
    const {
      TransactionOutput,
      Value,
      AssetName,
      MultiAsset,
      Assets,
      ScriptHash,
      BigNum,
      Address,
    } = cardanoWasm;

    const txBuilder = initTransactionBuilder(cardanoWasm, protocolParameters);

    const receiverAddr = Address.from_bech32(receiverAddress);
    const tokenUnit = AssetName.new(Buffer.from(tokenAssetName, "hex"));

    const value = Value.new(BigNum.from_str("0"));
    const multiAsset = MultiAsset.new();
    const asset = Assets.new();
    asset.insert(tokenUnit, BigNum.from_str(tokenAmount.toString()));
    multiAsset.insert(
      ScriptHash.from_bytes(Buffer.from(tokenPolicyId, "hex")),
      asset
    );
    value.set_multiasset(multiAsset);

    const minUTXO = await calculateMinUTXO(
      cardanoWasm,
      value,
      protocolParameters,
      multiAsset
    );
    value.set_coin(minUTXO);

    txBuilder.add_output(TransactionOutput.new(receiverAddr, value));

    const utxosHex = await walletApi.getUtxos();
    const utxos = utxosHex.map((hex) =>
      cardanoWasm.TransactionUnspentOutput.from_bytes(Buffer.from(hex, "hex"))
    );

    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      txBuilder.add_input(
        Address.from_bech32(await walletApi.getChangeAddress()),
        utxo.input(),
        utxo.output().amount()
      );
    }

    const fee = txBuilder.min_fee();
    txBuilder.set_fee(fee);

    const txBody = txBuilder.build();
    const signedTx = await walletApi.signTx(txBody, true);
    const txHash = await walletApi.submitTx(signedTx);

    return txHash;
  } catch (error) {
    console.error("Error transferring token:", error);
    throw new Error("Failed to transfer token.");
  }
};
