import { artifacts, ethers, network, waffle } from "hardhat";
import { expect } from "chai";
import { MockProvider } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "alchemy-sdk";
const { upgrades } = require("hardhat");
import Web3, { eth } from "web3";

const { provider } = waffle;
const web3 = new Web3(new Web3.providers.HttpProvider("http:// localhost:8545"));

async function increaseBlockTimestamp(provider: MockProvider, time: number) {
  await provider.send("evm_increaseTime", [time]);
  await provider.send("evm_mine", []);
}

describe("Lottery", async () => {
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let operator: SignerWithAddress;
  let Pair: SignerWithAddress;
  let Pool1: Contract;
  let StakingV1: Contract;
  let Extension: Contract;
  let TokenV2: Contract;
  let TokenV1: Contract;
  let UniswapRouter: Contract;
  let UniswapFactory: Contract;
  let lockPeriod: number;

  beforeEach(async() => {
    [owner, user1, user2, operator] = await ethers.getSigners();
    
    const routerABI = require("./ABI/UniswapRouter02.json");

    const tokenV1 = await ethers.getContractFactory("MockZookV1");
    TokenV1 = await tokenV1.deploy();
    await TokenV1.deployed();

    const tokenV2 = await ethers.getContractFactory("ZookV2");
    TokenV2 = await upgrades.deployProxy(tokenV2, [], {initializer: "initialize", kind: "uups"});
    
    
  });
});