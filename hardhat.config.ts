// @ts-nocheck
import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";

import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@openzeppelin/hardhat-upgrades";

dotenv.config();

// ===== Config
const config: HardhatUserConfig = {
  paths: {},
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        runs: 200,
        enabled: true,
      },
      outputSelection: {
        "*": {
          "*": ["storageLayout"],
        },
      },
    },
  },

  // Defining networks for testing and deployment
  defaultNetwork: "hardhat",
  networks: {
    // default & forking network
    hardhat: {
      forking: {
        /* @ts-ignore */
        url: "https://eth-mainnet.g.alchemy.com/v2/AqlUdmgjvOARQTmzfoQZO-Hi9nsnO_-Q"
        // ignoreUnknownTxType: true,
        // blockNumber: 18922981, // fork from this block
        //Accounts
        // accounts:
        //   process.env.DEPLOYER_PKEY !== undefined
        //     ? [process.env.DEPLOYER_PKEY]
        //     : [],
      },
      // chainId: 1337,
    },

    // Etherum mainnet
    // mainnet: {
    //   url: process.env.RPC_URL_MAINNET || "",
    // },
    // // Ethereum Goerli
    // goerli: {
    //   url: process.env.RPC_URL_GOERLI || "",
    //   accounts:
    //     process.env.DEPLOYER_PKEY !== undefined
    //       ? [process.env.DEPLOYER_PKEY]
    //       : [],
    // },
  },
  // Etherscan
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
};

export default config;
