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
    return parseInt(balanceInAda) / 1_000_000; // Return balance in ADA
  } catch (error) {
    console.error("Error fetching wallet balance:", error);
    throw new Error("Unable to fetch wallet balance.");
  }
};

// Initialize TransactionBuilder with protocol parameters
const initTransactionBuilder = (cardanoWasm, protocolParameters) => {
  const { LinearFee, TransactionBuilderConfigBuilder, BigNum } = cardanoWasm;

  // Set up transaction builder config
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
    .max_value_size(protocolParameters.max_value_size)
    .build();

  return cardanoWasm.TransactionBuilder.new(config);
};

// Transfer ADA

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

    const lovelaceAmount = adaAmount * 1_000_000; // Convert ADA to Lovelace
    const receiverAddr = Address.from_bech32(receiverAddress);
    const value = Value.new(BigNum.from_str(lovelaceAmount.toString()));
    txBuilder.add_output(TransactionOutput.new(receiverAddr, value));

    // Fetch wallet UTXOs and set inputs for the transaction
    const utxos = await walletApi.getUtxos();
    utxos.forEach((utxo) => {
      const input = cardanoWasm.TransactionInput.new(
        utxo.tx_hash(),
        utxo.output_index()
      );
      txBuilder.add_input(input, utxo.output().amount());
    });

    const fee = txBuilder.min_fee();
    txBuilder.set_fee(fee);

    const txBody = txBuilder.build();
    const signedTx = await walletApi.signTx(txBody, true);
    return await walletApi.submitTx(signedTx);
  } catch (error) {
    console.error("Error transferring ADA:", error);
    throw new Error("Failed to transfer ADA.");
  }
};

// Transfer Token
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

    txBuilder.add_output(TransactionOutput.new(receiverAddr, value));

    const utxos = await walletApi.getUtxos();
    utxos.forEach((utxo) => {
      const input = cardanoWasm.TransactionInput.new(
        utxo.tx_hash(),
        utxo.output_index()
      );
      txBuilder.add_input(input, utxo.output().amount());
    });

    const fee = txBuilder.min_fee();
    txBuilder.set_fee(fee);

    const txBody = txBuilder.build();
    const signedTx = await walletApi.signTx(txBody, true);
    return await walletApi.submitTx(signedTx);
  } catch (error) {
    console.error("Error transferring token:", error);
    throw new Error("Failed to transfer token.");
  }
};
