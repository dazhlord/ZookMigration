import { artifacts, ethers, network, waffle } from "hardhat";
import { expect } from "chai";
import { MockProvider } from "ethereum-waffle";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "alchemy-sdk";
const { upgrades } = require("hardhat");
import Web3, { eth } from "web3";

const { provider } = waffle;
const web3 = new Web3(
  new Web3.providers.HttpProvider("http:// localhost:8545"),
);

async function increaseBlockTimestamp(provider: MockProvider, time: number) {
  await provider.send("evm_increaseTime", [time]);
  await provider.send("evm_mine", []);
}

describe("Token Migration", async () => {
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let operator: SignerWithAddress;
  let rewardManager: SignerWithAddress;
  let Pair: SignerWithAddress;
  let TokenV2: Contract;
  let TokenV1: Contract;
  let UniswapRouter: Contract;
  let UniswapFactory: Contract;

  beforeEach(async () => {
    [owner, user1, user2, rewardManager, operator] = await ethers.getSigners();

    const routerABI = require("./ABI/UniswapRouter02.json");
    const factoryABI = require("./ABI/UniswapFactory02.json");
    UniswapRouter = await ethers.getContractAt(
      routerABI,
      "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    );
    UniswapFactory = await ethers.getContractAt(
      factoryABI,
      "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
    );

    const tokenV1 = await ethers.getContractFactory("MockZookV1");
    TokenV1 = await tokenV1.deploy();
    await TokenV1.deployed();

    const tokenV2 = await ethers.getContractFactory("ZookV2");
    TokenV2 = await upgrades.deployProxy(tokenV2, [], {
      initializer: "initialize",
      kind: "uups",
    });
  });
  describe("Main Functionality", async () => {
    beforeEach(async () => {
      // init configuration
      await TokenV2.setExcludedFromFees(user1.address, false);
      await TokenV2.setExcludedFromFees(user2.address, true);

      await TokenV2.setTokenV1(TokenV1.address);
      await TokenV2.setNewRouter(UniswapRouter.address);
      const lpPair = await TokenV2.lpPair();
      await TokenV2.transfer(lpPair, ethers.utils.parseEther("1000000"));

      await TokenV2.setTaxes(0, 1000, 0);
      await TokenV2.setRatios(1, 1, 1, 1);
      await TokenV2.setWallets(
        owner.address,
        owner.address,
        owner.address,
        owner.address,
      );
      await TokenV2.setSwapSettings(1, 1000000, 5, 1000000);
      await TokenV2.setPriceImpactSwapAmount(10);
      await TokenV2.setContractSwapEnabled(true, true);
      await TokenV2.lockTaxes();
      await TokenV2.setRewardRatio(5000); //50% reward to token holders
      await TokenV2.setTokenLimitForReward(100); // reward to holders more than 100 tokens
      await TokenV2.setRewardManager(rewardManager.address);
      await TokenV2.enableTrading();
    });
    describe("transfer", async () => {
      it("transfer", async () => {
        await TokenV2.transfer(user1.address, ethers.utils.parseEther("50"));
        const balanceUser = await TokenV2.balanceOf(user1.address);
        expect(balanceUser).to.be.eq(ethers.utils.parseEther("50"));
      });
      it("transferFrom", async () => {
        const balanceUser1Before = await TokenV2.balanceOf(user1.address);
        const balanceUser2Before = await TokenV2.balanceOf(user2.address);
        const balanceOwnerBefore = await TokenV2.balanceOf(owner.address);

        await TokenV2.approve(user1.address, ethers.utils.parseEther("50"));
        await TokenV2.connect(user1).transferFrom(
          owner.address,
          user2.address,
          ethers.utils.parseEther("50"),
        );

        const balanceUser1After = await TokenV2.balanceOf(user1.address);
        const balanceUser2After = await TokenV2.balanceOf(user2.address);
        const balanceOwnerAfter = await TokenV2.balanceOf(owner.address);

        const allowance = await TokenV2.allowance(owner.address, user1.address);

        expect(allowance).to.be.eq(0);
        expect(balanceUser1After).to.be.eq(balanceUser1Before);
        expect(balanceOwnerBefore.sub(balanceOwnerAfter)).to.be.eq(
          ethers.utils.parseEther("50"),
        );
        expect(balanceUser2After.sub(balanceUser2Before)).to.be.eq(
          ethers.utils.parseEther("50"),
        );
      });

      it("multiSend tokens", async () => {
        const balanceUser1Before = await TokenV2.balanceOf(user1.address);
        const balanceUser2Before = await TokenV2.balanceOf(user2.address);
        const balanceOwnerBefore = await TokenV2.balanceOf(owner.address);

        await TokenV2.multiSendTokens(
          [user1.address, user2.address],
          [ethers.utils.parseEther("50"), ethers.utils.parseEther("50")],
        );

        const balanceUser1After = await TokenV2.balanceOf(user1.address);
        const balanceUser2After = await TokenV2.balanceOf(user2.address);
        const balanceOwnerAfter = await TokenV2.balanceOf(owner.address);

        expect(balanceOwnerBefore.sub(balanceOwnerAfter)).to.be.eq(
          ethers.utils.parseEther("100"),
        );
        expect(balanceUser1After.sub(balanceUser1Before)).to.be.eq(
          ethers.utils.parseEther("50"),
        );
        expect(balanceUser2After.sub(balanceUser2Before)).to.be.eq(
          ethers.utils.parseEther("50"),
        );
      });

      it("contract swap", async () => {
        //create pair - ZOOK/WETH
        const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

        const pair = await UniswapFactory.getPair(TokenV2.address, WETH);
        const currentTime = (await ethers.provider.getBlock("latest"))
          .timestamp;

        await TokenV2.transfer(
          operator.address,
          ethers.utils.parseEther("1000"),
        );
        await TokenV2.connect(operator).approve(
          pair,
          ethers.utils.parseEther("1000"),
        );
        await TokenV2.connect(operator).approve(
          UniswapFactory.address,
          ethers.utils.parseEther("1000"),
        );
        await TokenV2.connect(operator).approve(
          UniswapRouter.address,
          ethers.utils.parseEther("1000"),
        );
        await UniswapRouter.connect(operator).addLiquidityETH(
          TokenV2.address,
          ethers.utils.parseEther("100"),
          0,
          0,
          operator.address,
          currentTime + 10000,
          { value: 100 },
        );
        await TokenV2.transfer(user1.address, ethers.utils.parseEther("100"));
        await TokenV2.transfer(
          TokenV2.address,
          ethers.utils.parseEther("1000"),
        );
        await TokenV2.connect(user1).transfer(
          pair,
          ethers.utils.parseEther("10"),
        );
      });

      it("revert transfer if not enough balance", async () => {
        await expect(
          TokenV2.connect(user2).transfer(
            user1.address,
            ethers.utils.parseEther("50"),
          ),
        ).to.be.revertedWith("insufficient balance");
      });
      it("revert transferFrom if not enough allowance", async () => {
        await expect(
          TokenV2.connect(user1).transferFrom(
            owner.address,
            user2.address,
            ethers.utils.parseEther("50"),
          ),
        ).to.be.revertedWith("insufficient allowance");
      });
      it("revert multiSendTokens if lengths don't match", async () => {
        await expect(
          TokenV2.multiSendTokens([user1.address, user2.address], [100]),
        ).to.be.revertedWith("Lengths don't match");
      });
      it("revert multiSendTOkens if not admin", async () => {
        await expect(
          TokenV2.connect(user2).multiSendTokens([user1.address], [100]),
        ).to.be.reverted;
      });
      it("revert transfer if blocked", async () => {
        await TokenV2.blockAddress(user1.address, true);
        await expect(TokenV2.transfer(user1.address, 100)).to.be.revertedWith(
          "transfer from/to blocked user",
        );
      });
      it("revert transfer from/to zero address", async () => {
        await expect(
          TokenV2.transfer(ethers.constants.AddressZero, 100),
        ).to.be.revertedWith("ERC20: transfer to the zero address");
      });
      it("revert approve from/to zero address", async () => {
        await expect(
          TokenV2.approve(ethers.constants.AddressZero, 100),
        ).to.be.revertedWith("ERC20: Zero Address");
      });
    });

    describe("migrate", async () => {
      it("migration", async () => {
        await TokenV1.mint(user1.address, ethers.utils.parseEther("100"));
        await TokenV1.connect(user1).approve(
          TokenV2.address,
          ethers.utils.parseEther("100"),
        );

        await TokenV2.setMigration();
        await TokenV2.migration(user1.address, ethers.utils.parseEther("100"));

        const balanceUser1TokenV1 = await TokenV1.balanceOf(user1.address);
        const balanceUser1TokenV2 = await TokenV2.balanceOf(user1.address);

        expect(balanceUser1TokenV1).to.be.eq(0);
        expect(balanceUser1TokenV2).to.be.eq(ethers.utils.parseEther("100"));
      });

      it("revert migration if migration disabled", async () => {
        await expect(
          TokenV2.migration(user1.address, ethers.utils.parseEther("100")),
        ).to.be.revertedWith("Migration Disabled");
      });
      it("revert migration if amount is invalid", async () => {
        await TokenV2.setMigration();
        await expect(TokenV2.migration(user1.address, 100)).to.be.revertedWith(
          "invalid input amount",
        );
      });
      it("revert migration if blocked user", async () => {
        await TokenV2.blockAddress(user1.address, true);

        await TokenV1.mint(user1.address, ethers.utils.parseEther("200"));
        await TokenV1.connect(user1).approve(
          TokenV2.address,
          ethers.utils.parseEther("200"),
        );

        await TokenV2.setMigration();
        await expect(
          TokenV2.migration(user1.address, ethers.utils.parseEther("100")),
        ).to.be.revertedWith("transfer from/to blocked user");
      });
      it("revert if already migrated", async () => {
        await TokenV1.mint(user1.address, ethers.utils.parseEther("200"));
        await TokenV1.connect(user1).approve(
          TokenV2.address,
          ethers.utils.parseEther("200"),
        );

        await TokenV2.setMigration();
        await TokenV2.migration(user1.address, ethers.utils.parseEther("100"));
        await expect(
          TokenV2.migration(user1.address, ethers.utils.parseEther("100")),
        ).to.be.revertedWith("Already Migrated");
      });
    });

    describe("distribute reward", async () => {
      beforeEach(async () => {
        // mint 100 to user1
        await TokenV2.transfer(user1.address, ethers.utils.parseEther("300"));
        // user1 transfer 100 to user2
        await TokenV2.connect(user1).transfer(
          user2.address,
          ethers.utils.parseEther("100"),
        );
      });

      it("get tax from sell transaction", async () => {
        const lpPair = await TokenV2.lpPair();
        // user1 sell 100 token
        // fees are claimed in this sell transaction
        await TokenV2.connect(user1).transfer(
          lpPair,
          ethers.utils.parseEther("100"),
        );
        // 100 * 10% / 2 = 5 reward to holders.
        const earnedTax = await TokenV2.balanceOf(rewardManager.address);
        const expectedTax = ethers.utils.parseEther("100").div(10).div(2);
        expect(earnedTax).to.be.eq(expectedTax);
      });
      it("distribute reward", async () => {
        const lpPair = await TokenV2.lpPair();
        await TokenV2.connect(user1).transfer(
          lpPair,
          ethers.utils.parseEther("100"),
        );
        await TokenV2.distributeReward();

        const lastRewardTime = await TokenV2.lastRewardTime();
        expect(Number(lastRewardTime)).to.be.greaterThan(0);
      });
      it("claim Reward", async () => {
        await TokenV2.transfer(user1.address, ethers.utils.parseEther("300"));

        const lpPair = await TokenV2.lpPair();
        // user1 sells 100 so remaining user1 - 400, user2 - 100
        await TokenV2.connect(user1).transfer(
          lpPair,
          ethers.utils.parseEther("100"),
        ); // get Tax on sell : 10
        // distribute Reward  rewardAmount = 5 (100 * sellFee / 100 / 2)
        await TokenV2.distributeReward();
        // mint user2 200 and user2 sells 200, so remaining user1 - 400 , user2 - 100
        await TokenV2.transfer(user2.address, ethers.utils.parseEther("200"));
        await TokenV2.connect(user2).transfer(
          lpPair,
          ethers.utils.parseEther("200"),
        ); // get Tax on sell : 20

        // increase timestamp 7 days
        await increaseBlockTimestamp(provider, 86400 * 7);
        // distribute Reward rewardAmount = 20 / 2 = 5
        await TokenV2.distributeReward();

        const user2BalanceBefore = await TokenV2.balanceOf(user2.address);
        // user2 claim rewards
        // reward : 5 * 100 / (100 + 400) + 10 * 100 / (400 + 100)  = 3;
        await TokenV2.connect(user2).claimReward();
        const user2BalanceAfter = await TokenV2.balanceOf(user2.address);
        expect(user2BalanceAfter.sub(user2BalanceBefore)).to.be.eq(
          ethers.utils.parseEther("3"),
        );
      });
      it("revert distribution if not owner", async () => {
        await expect(TokenV2.connect(user1).distributeReward()).to.be.reverted;
      });
      it("revert if time is too early", async () => {
        await TokenV2.distributeReward();
        await expect(TokenV2.distributeReward()).to.be.revertedWith(
          "Too Early",
        );
      });
    });
  });
  describe("Transfer/Renounce Ownership", async () => {
    it("transferOwner", async () => {
      await TokenV2.transferOwner(rewardManager.address);
      const newOwner = await TokenV2.getOwner();
      expect(newOwner).to.be.eq(rewardManager.address);
    });
    it("renouceOwner", async () => {
      await TokenV2.setNewRouter(UniswapRouter.address);
      const lpPair = await TokenV2.lpPair();
      await TokenV2.transfer(lpPair, ethers.utils.parseEther("1000000"));

      await TokenV2.enableTrading();
      await TokenV2.renounceOwnership();
      const newOwner = await TokenV2.getOwner();
      expect(newOwner).to.be.eq(ethers.constants.AddressZero);
    });
    it("revert if not admin", async () => {
      await expect(TokenV2.connect(user2).transferOwner(rewardManager.address))
        .to.be.reverted;
      await expect(TokenV2.connect(user1).renounceOwnership()).to.be.reverted;
    });
    it("revert if some other case", async () => {
      // zero address or DEAD
      await expect(
        TokenV2.transferOwner(ethers.constants.AddressZero),
      ).to.be.revertedWith(
        "Call renounceOwnership to transfer owner to the zero address",
      );
      await expect(
        TokenV2.transferOwner("0x000000000000000000000000000000000000dEaD"),
      ).to.be.revertedWith(
        "Call renounceOwnership to transfer owner to the zero address",
      );
    });
    it("revert renouceOwnership if trading is not enabled", async () => {
      await expect(TokenV2.renounceOwnership()).to.be.revertedWith(
        "Cannot renounce until trading has been enabled",
      );
    });
  });
  describe("Admin Role", async () => {
    it("approveContractContingency", async () => {
      await TokenV2.setNewRouter(UniswapRouter.address);
      await TokenV2.approveContractContingency();
      const allowance = await TokenV2.allowance(
        TokenV2.address,
        UniswapRouter.address,
      );
      expect(Number(allowance)).to.be.eq(2 ** 256 - 1);
    });
    it("sweepContingency", async () => {
      await TokenV2.transfer(TokenV2.address, 100);
      await TokenV2.sweepContingency();
    });
    it("sweepExternalTokens", async () => {
      await TokenV1.mint(TokenV2.address, 100);
      await TokenV2.transfer(TokenV2.address, 100);
      await TokenV2.sweepExternalTokens(TokenV1.address);
    });
    it("setLpPair", async () => {
      await TokenV2.setLpPair(user1.address, false);
      await TokenV2.setLpPair(user1.address, true);
    });
    it("setExcludedFromProtection", async () => {
      await TokenV2.setExcludedFromProtection(user1.address, true);
    });
    it("revert if not admin", async () => {
      await expect(TokenV2.connect(user1).setNewRouter(UniswapRouter.address))
        .to.be.reverted;
      await expect(TokenV2.connect(user1).approveContractContingency()).to.be
        .reverted;
      await expect(TokenV2.connect(user2).setTokenV1(user1.address)).to.be
        .reverted;
      await expect(TokenV2.connect(user2).setMigration()).to.be.reverted;
      await expect(TokenV2.connect(user2).setNewRouter(user1.address)).to.be
        .reverted;
      await expect(TokenV2.connect(user2).setLpPair(user1.address)).to.be
        .reverted;
      await expect(
        TokenV2.connect(user1).setExcludedFromProtection(user2.address, true),
      ).to.be.reverted;
      await expect(TokenV2.connect(user2).setTaxes(1, 1, 1)).to.be.reverted;
      await expect(TokenV2.connect(user2).lockTaxes).to.be.reverted;
      await expect(TokenV2.connect(user2).setContractSwapEnabled(true, true)).to
        .be.reverted;
      await expect(TokenV2.connect(user2).setPriceImpactSwapAmount(10)).to.be
        .reverted;
      await expect(TokenV2.connect(user2).setRatios(1, 1, 1, 1)).to.be.reverted;
      await expect(
        TokenV2.connect(user2).setExcludedFromFees(user1.address, true),
      ).to.be.reverted;
      await expect(TokenV2.connect(user2).blockAddress(user1.address, true)).to
        .be.reverted;
      await expect(TokenV2.connect(user2).setRewardRatio(10)).to.be.reverted;
      await expect(TokenV2.connect(user2).setRewardManager(user1.address)).to.be
        .reverted;
    });
    it("revert setTokenV1 if not before Migration", async () => {
      await TokenV2.setMigration();
      await expect(TokenV2.setTokenV1(user1.address)).to.be.revertedWith(
        "Migration Enabled",
      );
    });
    it("revert setRatios excess buy&sell fees", async () => {
      await expect(TokenV2.setRatios(500, 500, 500, 500)).to.be.revertedWith(
        "Cannot exceed sum of buy and sell fees",
      );
    });
    it("revert setTaxes", async () => {
      // if exceed maximum
      await expect(TokenV2.setTaxes(20000, 20000, 20000)).to.be.revertedWith(
        "Cannot exceed maximums",
      );
      // if locked
      await TokenV2.lockTaxes();
      await expect(TokenV2.setTaxes(1, 1, 1)).to.be.revertedWith(
        "Taxes are locked",
      );
    });
  });
  it("view functionality", async () => {
    await TokenV2.getTokenAmountAtPriceImpact(100);
    await TokenV2.getCirculatingSupply();
    await TokenV2.totalSupply();
    await TokenV2.decimals();
    await TokenV2.symbol();
    await TokenV2.name();
    await TokenV2.isExcludedFromFees(user1.address);
    await TokenV2.isExcludedFromProtection(user1.address);
  });
});
