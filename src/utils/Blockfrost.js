import { BlockFrostAPI } from '@blockfrost/blockfrost-js';

// Initialize Blockfrost API
const API = new BlockFrostAPI({
  projectId: 'mainnetl7kg73l1Eh3mif46gJOJHIfTtbYosjl8',
});

// Fetch the list of all available tokens on Cardano
export const fetchAllTokens = async () => {
  try {
    const assets = await API.assets();
    return assets.map((asset) => ({
      symbol: asset.asset_name ? Buffer.from(asset.asset_name, 'hex').toString() : 'Unknown',
      name: asset.fingerprint,
      image: `https://assets.blockfrost.dev/${asset.asset}`, // Placeholder for image
      verified: asset.metadata?.verified ?? false, // If the token is verified
    }));
  } catch (error) {
    console.error('Error fetching tokens:', error);
    return [];
  }
};

// Fetch the user's wallet token balances
export const fetchWalletBalances = async (walletAddress) => {
  try {
    const addresses = await API.addresses(walletAddress);
    const balances = addresses.amount.map((amount) => ({
      symbol: amount.unit === 'lovelace' ? 'ADA' : amount.unit,
      balance: amount.quantity,
    }));
    return balances;
  } catch (error) {
    console.error('Error fetching wallet balances:', error);
    return [];
  }
};
