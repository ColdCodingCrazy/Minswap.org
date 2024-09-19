import { useState } from "react";

const TokenModal = ({ tokens, onSelect, onClose }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [verifiedOnly, setVerifiedOnly] = useState(true);

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleVerifiedToggle = () => {
    setVerifiedOnly(!verifiedOnly);
  };

  const filteredTokens = tokens.filter((token) => {
    const matchesSearch = token.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      token.symbol.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesVerified = !verifiedOnly || token.verified;

    return matchesSearch && matchesVerified;
  });

  return (
    <div className="fixed inset-0 bg-ovl-md backdrop-blur-sm bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[#1a1b20] p-6 w-[400px] rounded-xl relative">
        {/* Modal Title and Close Button */}
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-bold text-white">Select Token</h1>
          <button onClick={onClose} className="text-white text-2xl">
            &times;
          </button>
        </div>

        {/* Search Bar */}
        <div className="flex items-center bg-[#2b2c30] p-2 rounded-full mb-4">
          <svg
            className="w-5 h-5 text-gray-400 ml-2"
            fill="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M10 2C5.58172 2 2 5.58172 2 10C2 14.4183 5.58172 18 10 18C12.0361 18 13.8897 17.2623 15.294 16.0137L19.2929 20.0126L20.7071 18.5984L16.7083 14.5995C17.9559 13.1953 18.6935 11.3418 18.6935 9.30573C18.6935 4.88744 15.1122 1.30615 10.6939 1.30615C6.27557 1.30615 2.6935 4.88744 2.6935 9.30573C2.6935 11.3418 3.43105 13.1953 4.70685 14.5995C6.11107 17.2623 8.03614 18 10 18ZM10 3.6935C14.0607 3.6935 17.3061 6.93904 17.3061 10.9998C17.3061 15.0606 14.0607 18.3061 10 18.3061C5.93929 18.3061 2.6935 15.0606 2.6935 10.9998C2.6935 6.93904 5.93929 3.6935 10 3.6935Z"
            />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search by name or symbol"
            className="bg-transparent w-full outline-none text-white ml-2"
          />
        </div>

        {/* Verified Tokens Toggle */}
        <div className="flex justify-between items-center mb-4 bg-[#89aaff3d] p-1 rounded-full">
          <p className="text-gray-400">Verified tokens only</p>
          <label className="inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={verifiedOnly}
              onChange={handleVerifiedToggle}
              className="sr-only"
            />
            <span
              className={`${
                verifiedOnly ? "bg-blue-500" : "bg-gray-400"
              } relative inline-block w-10 h-6 rounded-full transition-colors`}
            >
              <span
                className={`${
                  verifiedOnly ? "translate-x-5" : "translate-x-1"
                } absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform`}
              ></span>
            </span>
          </label>
        </div>

        {/* Token List */}
        <div className="h-64 overflow-y-auto border-t border-gray-600">
          {filteredTokens.map((token) => (
            <div
              key={token.symbol}
              onClick={() => onSelect(token.symbol)}
              className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-700"
            >
              <div className="flex items-center">
                <img
                  src={token.image}
                  alt={token.symbol}
                  className="w-8 h-8 mr-3"
                />
                <div>
                  <p className="text-white font-medium">{token.symbol}</p>
                  <p className="text-gray-400 text-sm">{token.name}</p>
                </div>
              </div>
              <div className="text-white">
                {token.balance}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TokenModal;
