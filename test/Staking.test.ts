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
  let fixedAPR1: number;

  beforeEach(async() => {
    [owner, user1, user2, operator] = await ethers.getSigners();
    
    const routerABI = require("./ABI/UniswapRouter02.json");
    const factoryABI = require("./ABI/UniswapFactory02.json");
    UniswapRouter = await ethers.getContractAt(routerABI, "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D");
    UniswapFactory = await ethers.getContractAt(factoryABI, "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f");
    
    // Deploy tokenV2
    const tokenV2 = await ethers.getContractFactory("MockZook");
    TokenV2 = await tokenV2.deploy();
    await TokenV2.deployed();

    await TokenV2.mint(user1.address, ethers.utils.parseEther("1000"));
    await TokenV2.mint(user2.address, ethers.utils.parseEther("1000"));

    lockPeriod = 86400 * 28;

    // Deploy StakingV2 contract using proxy
    const pool1 = await ethers.getContractFactory("StakingPoolUpgradeable");
    Pool1 = await upgrades.deployProxy(pool1, [TokenV2.address,lockPeriod, UniswapRouter.address], { initializer: "initialize", kind: "uups" });

    // Deploy TokenStakingPool(extension)
    fixedAPR1 = 25;
    const extension = await ethers.getContractFactory("TokenStakingPool");
    Extension = await extension.deploy(Pool1.address, TokenV2.address, fixedAPR1);
    await Extension.deployed();

    // Deploy tokenV1 and StsakingV1
    const tokenV1 = await ethers.getContractFactory("MockZookV1");
    TokenV1 = await tokenV1.deploy();
    await TokenV1.deployed();

    const stakingV1 = await ethers.getContractFactory("MockStakingV1");
    StakingV1 = await stakingV1.deploy(TokenV1.address);
    await StakingV1.deployed();
    
    // Set Extension
    await Pool1.setPoolExtension(Extension.address);

    //create pair - ZOOK/WETH
    const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
   
    await UniswapFactory.createPair(WETH, TokenV2.address);
    const pair = await UniswapFactory.getPair(TokenV2.address, WETH);
    const currentTime = (await ethers.provider.getBlock("latest")).timestamp;

    await TokenV2.mint(operator.address, ethers.utils.parseEther("1000"));
    await TokenV2.connect(operator).approve(pair, ethers.utils.parseEther("1000"));
    await TokenV2.connect(operator).approve(UniswapFactory.address, ethers.utils.parseEther("1000"));
    await TokenV2.connect(operator).approve(UniswapRouter.address, ethers.utils.parseEther("1000"));
    await UniswapRouter.connect(operator).addLiquidityETH(TokenV2.address, ethers.utils.parseEther("100"), 0, 0, operator.address, currentTime + 10000, { value: 100});
  })

  describe("stake", async() => {
    it("user1 stake - new staker", async() => {
      // user1 stake to pool1
      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user1).stake(ethers.utils.parseEther("10"));

      const totalShares = await Pool1.totalSharesDeposited();
      const totalUsers = await Pool1.totalStakedUsers();
      const tokenBalancePool1 = await TokenV2.balanceOf(Pool1.address);
      const stakerInfo = await Pool1.shares(user1.address);

      expect(totalShares).to.be.eq(ethers.utils.parseEther("10"));
      expect(totalUsers).to.be.eq(1);
      expect(tokenBalancePool1).to.be.eq(ethers.utils.parseEther("10"));
      expect(stakerInfo.amount).to.be.eq(ethers.utils.parseEther("10"));
    })

    it("user1 stake again", async() => {
      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user1).stake(ethers.utils.parseEther("10"));

      // user1 stake again after 14 days with same amount
      await increaseBlockTimestamp(provider, 86400 * 14);

      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user1).stake(ethers.utils.parseEther("10"));

      // user1 will have increased reward
      const rewardToClaimUser1= await Extension.rewardOf(user1.address);
        // expected Reward: stakedAmount * fixedAPR * stakedTime / 365 / 100  = 
        // 10* 10**18 * 25 * 14 / 365 / 100
      const expectReward = ethers.utils.parseEther("10").mul(350).div(36500);

      const totalShares = await Pool1.totalSharesDeposited();
      const totalUsers = await Pool1.totalStakedUsers();
      const tokenBalancePool1 = await TokenV2.balanceOf(Pool1.address);
      const stakerInfo = await Pool1.shares(user1.address);

      expect(totalShares).to.be.eq(ethers.utils.parseEther("20"));
      expect(totalUsers).to.be.eq(1);
      expect(tokenBalancePool1).to.be.eq(ethers.utils.parseEther("20"));
      expect(stakerInfo.amount).to.be.eq(ethers.utils.parseEther("20"));
      expect(Number(rewardToClaimUser1.sub(expectReward))).to.be.lessThanOrEqual(Number(rewardToClaimUser1.div(10000)));
    })

    it("rewards are distributed with shares", async() => {
      await TokenV2.mint(Extension.address, ethers.utils.parseEther("100"));
      // user1 stakes 10, user2 stakes 20 at first time
      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user1).stake(ethers.utils.parseEther("10"));

      await TokenV2.connect(user2).approve(Pool1.address, ethers.utils.parseEther("20"));
      await Pool1.connect(user2).stake(ethers.utils.parseEther("20"));

      // user1 stake 10 again after 14 days
      await increaseBlockTimestamp(provider, 86400 * 14);

      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));   
      await Pool1.connect(user1).stake(ethers.utils.parseEther("10"));

      // calculate reward distribution in current state
      // reward of user2 = rewar of user1 * 2
      const rewardToClaimUser1 = await Extension.rewardOf(user1.address);
      const rewardToClaimUser2 = await Extension.rewardOf(user2.address);

      // claim rewards
      await Extension.connect(user1).claimRewards();
      await Extension.connect(user2).claimRewards();

      // claim rewards after 14 days
      await increaseBlockTimestamp(provider, 86400 * 14);
      
      // calulcate rewards of user1, user2
      // user1 reward = user2 reward
      const rewardToClaimUser1Again = await Extension.rewardOf(user1.address);
      const rewardToClaimUser2Again = await Extension.rewardOf(user2.address);

      expect(Number(rewardToClaimUser2.sub(rewardToClaimUser1.mul(2)))).to.be.lessThanOrEqual(Number(rewardToClaimUser1.div(10000)));
      expect(Number(rewardToClaimUser2Again.sub(rewardToClaimUser1Again))).to.be.lessThanOrEqual(Number(rewardToClaimUser1Again.div(10000)));
    })
    it("stakeForWallets", async() => {
      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user1).stakeForWallets([user2.address], [ethers.utils.parseEther("10")]);

      await TokenV2.connect(user2).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user2).stake(ethers.utils.parseEther("10"));

      const totalShares = await Pool1.totalSharesDeposited();
      const totalUsers = await Pool1.totalStakedUsers();
      const tokenBalancePool1 = await TokenV2.balanceOf(Pool1.address);
      const stakerInfo = await Pool1.shares(user2.address);

      expect(totalShares).to.be.eq(ethers.utils.parseEther("20"));
      expect(totalUsers).to.be.eq(1);
      expect(tokenBalancePool1).to.be.eq(ethers.utils.parseEther("20"));
      expect(stakerInfo.amount).to.be.eq(ethers.utils.parseEther("20"));
    })
    it("stakeForWallets revert if invalid length input", async() => {
      await expect(Pool1.connect(user1).stakeForWallets([user1.address, user2.address], [ethers.utils.parseEther("10")])).to.be.revertedWith("INSYNC");
    })
  })
  describe("deposit reward", async() => {
    it("deposit rewards", async() => {
      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user1).stake(ethers.utils.parseEther("10"));

      // earned eth reward will be deposited to 3 pools according to their percentages      
      await Pool1.connect(operator).depositRewards({value: 10});

      const totalRewards = await Pool1.totalRewards();
      const rewardsPerShare = await Pool1.rewardsPerShare();
      const totalSharesDeposited = await Pool1.totalSharesDeposited();
      
      expect(totalRewards).to.be.eq(10);
      expect(rewardsPerShare).to.be.eq(ethers.utils.parseUnits("10", 36).div(totalSharesDeposited));
    })
    it("revert if invalid input amount", async() => {
      await expect(Pool1.connect(operator).depositRewards({value: 0})).to.be.revertedWith("ETH");
    })
    it("revert if no staked share", async() => {
      await expect(Pool1.connect(operator).depositRewards({value: 10})).to.be.revertedWith("SHARES");
    })
  })
  describe("unstake", async() => {
    beforeEach(async() => {
      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user1).stake(ethers.utils.parseEther("10"));

      await increaseBlockTimestamp(provider, 86400 * 14);
      await Pool1.connect(operator).depositRewards({value: 10});

      await TokenV2.connect(user2).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user2).stake(ethers.utils.parseEther("10"));
    })
    it("unstake", async() => {
      const user1TokenV2BalanceBefore = await TokenV2.balanceOf(user1.address);
      const rewardsPerShareBefore = await Pool1.rewardsPerShare();

      // user1 unstake 5
      await increaseBlockTimestamp(provider, 86400 * 14);
      await Pool1.connect(user1).unstake(ethers.utils.parseEther("5"));

      const user1TokenV2BalanceAfter = await TokenV2.balanceOf(user1.address);
      const user1TokenV2Reward =  ethers.utils.parseEther("10").mul(350).div(36500);

      const rewardsPerShareAfter = await Pool1.rewardsPerShare();
      const totalSharesDeposited = await Pool1.totalSharesDeposited();
      //calculate rewardPerShare
      const expectedRewardPerShare = rewardsPerShareBefore.add(ethers.utils.parseUnits("10", 36).div(totalSharesDeposited));

      expect(Number(user1TokenV2BalanceBefore.sub(user1TokenV2BalanceAfter).sub(ethers.utils.parseEther("5")))).to.be.lessThanOrEqual(Number(user1TokenV2Reward));
      expect(rewardsPerShareAfter).to.be.eq(expectedRewardPerShare);
    })

    it("revert if before lock time", async() => {
      await expect(Pool1.connect(user1).unstake(ethers.utils.parseEther("5"))).to.be.revertedWith("REM: timelock");

    })
    it("revert if invalid unstake amount", async() => {
      await increaseBlockTimestamp(provider, 86400 * 14);
      await expect(Pool1.connect(user1).unstake(ethers.utils.parseEther("20"))).to.be.revertedWith("REM: amount");
    })
  })
  describe("claimReward", async() => {
    beforeEach(async() => {
      await TokenV2.connect(user1).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user1).stake(ethers.utils.parseEther("10"));

      await increaseBlockTimestamp(provider, 86400 * 14);
      await Pool1.connect(operator).depositRewards({value: 10});

      await TokenV2.connect(user2).approve(Pool1.address, ethers.utils.parseEther("10"));
      await Pool1.connect(user2).stake(ethers.utils.parseEther("10"));
    })
    it("claimReward - user", async() => {
      await increaseBlockTimestamp(provider, 86400 * 14);

      await Pool1.connect(user1).claimReward(false, 0);
    })
    it("claimReward - Admin", async() => {

      await increaseBlockTimestamp(provider, 86400 * 14);
      await Pool1.claimRewardAdmin(user1.address, false, 0);
    })
    it("compound claimed reward - eth", async() => {
      await increaseBlockTimestamp(provider, 86400 * 14);

      const poolTokenV2BalanceBefore = await TokenV2.balanceOf(Pool1.address);
      const shareInfoUser1Before = await Pool1.shares(user1.address);

      //claim Reward and compound
      await Pool1.connect(user1).claimReward(true, 0);

      const poolTokenV2BalanceAfter = await TokenV2.balanceOf(Pool1.address);
      const shareInfoUser1After = await Pool1.shares(user1.address);

      // claimed reward will be swapped to ZOOKV2 token and compounded into stakingContract as user1's share
      expect(Number(poolTokenV2BalanceAfter.sub(poolTokenV2BalanceBefore))).to.be.greaterThan(0);
      expect(shareInfoUser1After.amount.sub(shareInfoUser1Before.amount)).to.be.eq(poolTokenV2BalanceAfter.sub(poolTokenV2BalanceBefore));
    })
    it("revert claimRewardAdmin if not Admin", async() => {
      await expect(Pool1.connect(user2).claimRewardAdmin(user1.address, false, 0)).to.be.reverted;
    })
  })
  describe("withdraw", async() => {
    it("withdraw - admin", async() => {
      await TokenV2.mint(Pool1.address, ethers.utils.parseEther("100"));
      await Pool1.withdrawTokens(ethers.utils.parseEther("10"));
      const ownerBalance = await TokenV2.balanceOf(owner.address);
      expect(ownerBalance).to.be.eq(ethers.utils.parseEther("10"));
    })
    it("revert if not admin", async() => {
      await expect(Pool1.connect(user1).withdrawTokens(10)).to.be.reverted;
    })
  })
  describe("migrate", async() => {
    beforeEach(async() => {
      // do initialize traiding on StakingV1 for test
      await TokenV1.mint(user1.address, ethers.utils.parseEther("10"));
      await TokenV1.connect(user1).approve(StakingV1.address, ethers.utils.parseEther("10"));
      //user1 stake 10 into V1
      await StakingV1.connect(user1).stake(1, ethers.utils.parseEther("10"));

      await Pool1.setStakingV1(StakingV1.address);
      await StakingV1.transferOwnership(Pool1.address);
    })
    it("migrate", async() => {
      await Pool1.migrate(user1.address);

      const pool1TokenV1Balance = await TokenV1.balanceOf(Pool1.address);
      const totalShares = await Pool1.totalSharesDeposited();
      const totalUsers = await Pool1.totalStakedUsers();
      const tokenBalancePool1 = await TokenV2.balanceOf(Pool1.address);
      const stakerInfo = await Pool1.shares(user1.address);

      expect(totalShares).to.be.eq(ethers.utils.parseEther("10"));
      expect(totalUsers).to.be.eq(1);
      expect(tokenBalancePool1).to.be.eq(ethers.utils.parseEther("0"));
      expect(stakerInfo.amount).to.be.eq(ethers.utils.parseEther("10"));
      expect(pool1TokenV1Balance).to.be.eq(ethers.utils.parseEther("10"));
    })
    it("revert if not admin", async() => {
      await expect(Pool1.connect(user1).migrate(user1.address)).to.be.reverted;
    })
    it("revert if already migrated", async() => {
      await Pool1.migrate(user1.address);
      await expect(Pool1.migrate(user1.address)).to.be.revertedWith("Already migrated!");
    })
    it("revert if invalid stakingV1 contract", async() => {
      await Pool1.setStakingV1("0x0000000000000000000000000000000000000000");   //set stakingv1 address as zero
      await expect(Pool1.migrate(user1.address)).to.be.revertedWith("Invalid staking v1 contract");
    })
    it("not migrated if already claimed", async() => {
      await TokenV1.mint(StakingV1.address, ethers.utils.parseEther("100"));

      await increaseBlockTimestamp(provider, 86400 * 28);
      await StakingV1.connect(user1).claim(0);

      await Pool1.migrate(user1.address);
      const totalShares = await Pool1.totalSharesDeposited();
      expect(totalShares).to.be.eq(ethers.utils.parseEther("0"));
    })
  })
  describe("admin configuration role", async() => {
    it("setPoolExtension", async() => {
      await Pool1.setPoolExtension(operator.address);
      const extension = await Pool1.extension();
      expect(extension).to.be.eq(operator.address);
    })
    it("setStakingV1", async() => {
      await Pool1.setStakingV1(operator.address);
      const stakingV1 = await Pool1.stakingV1();
      expect(stakingV1).to.be.eq(operator.address);
    })
    it("setLockupPeriod", async() => {
      await Pool1.setLockupPeriod(86400 * 35); // 35 days
      const lockupPeriod = await Pool1.lockupPeriod();
      expect(lockupPeriod).to.be.eq(86400 * 35);
    })

    it("revert if not admin", async() => {
      await expect(Pool1.connect(user1).setPoolExtension(operator.address)).to.be.reverted;
      await expect(Pool1.connect(user1).setStakingV1(operator.address)).to.be.reverted;
      await expect(Pool1.connect(user1).setLockupPeriod(86400 * 35)).to.be.reverted;
    })
    it("setLockupPeriod revert if lockupPeriod is over 1 year", async() => {
      await expect(Pool1.setLockupPeriod(86400 * 365)).to.be.reverted;
    })
  })
  describe("some cases", async()=> {
    it("getUnpaid will return zero if user has no share", async() => {
      const getUnpaid = await Pool1.getUnpaid(user1.address);
      expect(getUnpaid).to.be.eq(0);
    })
  })
});