import { configureStore } from '@reduxjs/toolkit';
import downloadReducer from './downloadSlice';
import chainsReducer from './chainsSlice';
import downloadModalReducer from './downloadModalSlice';
import faucetReducer from './faucetSlice';
import walletModalReducer from './walletModalSlice';

export const store = configureStore({
  reducer: {
    downloads: downloadReducer,
    chains: chainsReducer,
    downloadModal: downloadModalReducer,
    faucet: faucetReducer,
    walletModal: walletModalReducer,
  },
});
