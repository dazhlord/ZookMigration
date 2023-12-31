// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.9.0;
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "./interfaces/IERC20.sol";

contract ZookV2 is
    IERC20,
    Initializable,
    UUPSUpgradeable,
    ContextUpgradeable,
    ReentrancyGuardUpgradeable
{
    mapping(address => uint256) private _tOwned;
    mapping(address => bool) lpPairs;
    uint256 private timeSinceLastPair;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) private _liquidityHolders;
    mapping(address => bool) private _isExcludedFromProtection;
    mapping(address => bool) private _isExcludedFromFees;
    uint256 private constant startingSupply = 1_000_000_000;
    string private constant _name = "ZOOK";
    string private constant _symbol = "$ZOOK";
    uint8 private constant _decimals = 18;
    uint256 private constant _tTotal = startingSupply * 10 ** _decimals;

    struct Fees {
        uint16 buyFee;
        uint16 sellFee;
        uint16 transferFee;
    }

    struct Ratios {
        uint16 marketing;
        uint16 development;
        uint16 staking;
        uint16 totalSwap;
    }

    Fees public _taxRates;

    Ratios public _ratios;

    uint256 public constant maxBuyTaxes = 1000;
    uint256 public constant maxSellTaxes = 1000;
    uint256 public constant maxTransferTaxes = 1000;
    uint256 constant masterTaxDivisor = 10000;

    bool public taxesAreLocked;
    IUniswapV2Router02 public dexRouter;
    address public lpPair;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    struct TaxWallets {
        address payable marketing;
        address payable development;
        address payable staking;
    }

    TaxWallets public _taxWallets;

    bool inSwap;
    bool public contractSwapEnabled;
    uint256 public swapThreshold;
    uint256 public swapAmount;
    bool public piContractSwapsEnabled;
    uint256 public piSwapPercent;
    bool public tradingEnabled;
    bool public _hasLiqBeenAdded;
    uint256 public launchStamp;

    // add variables for token Migration
    address tokenV1;
    uint256 isMigration;
    mapping(address => bool) public migrated;
    mapping(address => bool) public blocked;

    event ContractSwapEnabledUpdated(bool enabled);
    event AutoLiquify(uint256 amountCurrency, uint256 amountTokens);
    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    modifier inSwapFlag() {
        inSwap = true;
        _;
        inSwap = false;
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function initialize() public payable initializer {
        __UUPSUpgradeable_init();
        __Context_init();
        __ReentrancyGuard_init();

        // Set the owner.
        _owner = msg.sender;

        _tOwned[_owner] = _tTotal;
        emit Transfer(address(0), _owner, _tTotal);

        _isExcludedFromFees[_owner] = true;
        _isExcludedFromFees[address(this)] = true;
        _isExcludedFromFees[DEAD] = true;
        _liquidityHolders[_owner] = true;

        _isExcludedFromFees[0x407993575c91ce7643a4d4cCACc9A98c36eE1BBE] = true; // PinkLock
        _isExcludedFromFees[0x663A5C229c09b049E36dCc11a9B0d4a8Eb9db214] = true; // Unicrypt (ETH)
        _isExcludedFromFees[0xDba68f07d1b7Ca219f78ae8582C213d975c25cAf] = true; // Unicrypt (ETH)

        _taxRates = Fees({buyFee: 500, sellFee: 1000, transferFee: 0});

        _ratios = Ratios({
            marketing: 2,
            development: 2,
            staking: 1,
            totalSwap: 5
        });

        _taxWallets = TaxWallets({
            marketing: payable(0x130AB17c594E8f25532B19c347325C832b5F2cB1),
            development: payable(0xF0DAe241ce1a4546980d025DBF2840DBc3112F78),
            staking: payable(0x8B505E46fD52723430590A6f4F9d768618e29a4B)
        });

        piSwapPercent = 10;
    }

    //===============================================================================================================
    //===============================================================================================================
    //===============================================================================================================
    // Ownable removed as a lib and added here to allow for custom transfers and renouncements.
    // This allows for removal of ownership privileges from the owner once renounced or transferred.
    address private _owner;

    modifier onlyOwner() {
        require(_owner == msg.sender, "Caller =/= owner");
        _;
    }

    function transferOwner(address newOwner) external onlyOwner {
        require(
            newOwner != address(0) && newOwner != DEAD,
            "Call renounceOwnership to transfer owner to the zero address"
        );

        setExcludedFromFees(_owner, false);
        setExcludedFromFees(newOwner, true);

        if (balanceOf(_owner) > 0) {
            _finalizeTransfer(
                _owner,
                newOwner,
                balanceOf(_owner),
                false,
                false,
                true
            );
        }

        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function renounceOwnership() public onlyOwner {
        require(
            tradingEnabled,
            "Cannot renounce until trading has been enabled"
        );
        setExcludedFromFees(_owner, false);
        address oldOwner = _owner;
        _owner = address(0);
        emit OwnershipTransferred(oldOwner, address(0));
    }

    //===============================================================================================================
    //===============================================================================================================
    //===============================================================================================================

    receive() external payable {}

    function setExcludedFromFees(
        address account,
        bool enabled
    ) public onlyOwner {
        _isExcludedFromFees[account] = enabled;
    }

    function balanceOf(address account) public view override returns (uint256) {
        return _tOwned[account];
    }

    function transfer(
        address recipient,
        uint256 amount
    ) external override returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external override returns (bool) {
        require(
            _allowances[sender][msg.sender] >= amount,
            "insufficient allowance"
        );
        if (_allowances[sender][msg.sender] != type(uint256).max) {
            _allowances[sender][msg.sender] -= amount;
        }

        return _transfer(sender, recipient, amount);
    }

    function approve(
        address spender,
        uint256 amount
    ) external override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function multiSendTokens(
        address[] memory accounts,
        uint256[] memory amounts
    ) external onlyOwner {
        require(accounts.length == amounts.length, "Lengths don't match");
        for (uint16 i = 0; i < accounts.length; i++) {
            _finalizeTransfer(
                msg.sender,
                accounts[i],
                amounts[i],
                false,
                false,
                true
            );
        }
    }

    function enableTrading() external onlyOwner {
        require(!tradingEnabled, "Trading already enabled");
        require(_hasLiqBeenAdded, "Liquidity must be added");
        tradingEnabled = true;
        launchStamp = block.timestamp;
    }

    function migration(address user, uint256 amount) external onlyOwner {
        require(isMigration == 1 || isMigration == 3, "Migration Disabled");
        require(!migrated[user], "Already Migrated");
        require(
            IERC20(tokenV1).balanceOf(user) >= amount,
            "invalid input amount"
        );

        migrated[user] = true;

        IERC20(tokenV1).transferFrom(user, address(this), amount);
        _transfer(msg.sender, user, amount);
    }

    function approveContractContingency() external onlyOwner returns (bool) {
        _approve(address(this), address(dexRouter), type(uint256).max);
        return true;
    }

    function setTokenV1(address _tokenV1) external onlyOwner {
        require(isMigration == 0, "Migration Enabled");
        tokenV1 = _tokenV1;
    }

    function setMigration() external onlyOwner {
        isMigration++;
    }

    function setNewRouter(address newRouter) external onlyOwner {
        require(!_hasLiqBeenAdded, "Cannot change after liquidity");
        IUniswapV2Router02 _newRouter = IUniswapV2Router02(newRouter);
        address get_pair = IUniswapV2Factory(_newRouter.factory()).getPair(
            address(this),
            _newRouter.WETH()
        );
        lpPairs[lpPair] = false;
        if (get_pair == address(0)) {
            lpPair = IUniswapV2Factory(_newRouter.factory()).createPair(
                address(this),
                _newRouter.WETH()
            );
        } else {
            lpPair = get_pair;
        }
        dexRouter = _newRouter;
        lpPairs[lpPair] = true;
        _approve(address(this), address(dexRouter), type(uint256).max);
    }

    function setLpPair(address pair, bool enabled) external onlyOwner {
        if (!enabled) {
            lpPairs[pair] = false;
        } else {
            if (timeSinceLastPair != 0) {
                require(
                    block.timestamp - timeSinceLastPair > 3 days,
                    "3 Day cooldown"
                );
            }
            require(!lpPairs[pair], "Pair already added to list");
            lpPairs[pair] = true;
            timeSinceLastPair = block.timestamp;
        }
    }

    function setExcludedFromProtection(
        address account,
        bool enabled
    ) external onlyOwner {
        _isExcludedFromProtection[account] = enabled;
    }

    function setTaxes(
        uint16 buyFee,
        uint16 sellFee,
        uint16 transferFee
    ) external onlyOwner {
        require(!taxesAreLocked, "Taxes are locked");
        require(
            buyFee <= maxBuyTaxes &&
                sellFee <= maxSellTaxes &&
                transferFee <= maxTransferTaxes,
            "Cannot exceed maximums"
        );
        _taxRates.buyFee = buyFee;
        _taxRates.sellFee = sellFee;
        _taxRates.transferFee = transferFee;
    }

    function setRatios(
        uint16 marketing,
        uint16 development,
        uint16 staking
    ) external onlyOwner {
        _ratios.marketing = marketing;
        _ratios.development = development;
        _ratios.staking = staking;
        _ratios.totalSwap = marketing + staking + development;
        uint256 total = _taxRates.buyFee + _taxRates.sellFee;
        require(
            _ratios.totalSwap <= total,
            "Cannot exceed sum of buy and sell fees"
        );
    }

    function setWallets(
        address payable marketing,
        address payable staking,
        address payable development
    ) external onlyOwner {
        require(
            marketing != address(0) &&
                staking != address(0) &&
                development != address(0),
            "Cannot be zero address"
        );
        _taxWallets.marketing = payable(marketing);
        _taxWallets.development = payable(development);
        _taxWallets.staking = payable(staking);
    }

    function setSwapSettings(
        uint256 thresholdPercent,
        uint256 thresholdDivisor,
        uint256 amountPercent,
        uint256 amountDivisor
    ) external onlyOwner {
        swapThreshold = (_tTotal * thresholdPercent) / thresholdDivisor;
        swapAmount = (_tTotal * amountPercent) / amountDivisor;
        require(
            swapThreshold <= swapAmount,
            "Threshold cannot be above amount"
        );
        require(
            swapAmount <= (balanceOf(lpPair) * 150) / masterTaxDivisor,
            "Cannot be above 1.5% of current PI"
        );
        require(
            swapAmount >= _tTotal / 1_000_000,
            "Cannot be lower than 0.00001% of total supply"
        );
        require(
            swapThreshold >= _tTotal / 1_000_000,
            "Cannot be lower than 0.00001% of total supply"
        );
    }

    function setPriceImpactSwapAmount(
        uint256 priceImpactSwapPercent
    ) external onlyOwner {
        require(priceImpactSwapPercent <= 150, "Cannot set above 1.5%");
        piSwapPercent = priceImpactSwapPercent;
    }

    function setContractSwapEnabled(
        bool swapEnabled,
        bool priceImpactSwapEnabled
    ) external onlyOwner {
        contractSwapEnabled = swapEnabled;
        piContractSwapsEnabled = priceImpactSwapEnabled;
        emit ContractSwapEnabledUpdated(swapEnabled);
    }

    function sweepContingency() external onlyOwner {
        require(!_hasLiqBeenAdded, "Cannot call after liquidity");
        payable(_owner).transfer(address(this).balance);
    }

    function sweepExternalTokens(address token) external onlyOwner {
        if (_hasLiqBeenAdded) {
            require(token != address(this), "Cannot sweep native tokens");
        }
        IERC20 TOKEN = IERC20(token);
        TOKEN.transfer(_owner, TOKEN.balanceOf(address(this)));
    }

    function lockTaxes() external onlyOwner {
        // This will lock taxes at their current value forever, do not call this unless you're sure.
        taxesAreLocked = true;
    }

    function blockAddress(address user, bool state) external onlyOwner {
        require(
            user != address(0) && user != address(DEAD),
            "Cannot block zero address"
        );
        blocked[user] = state;
    }

    function getTokenAmountAtPriceImpact(
        uint256 priceImpactInHundreds
    ) external view returns (uint256) {
        return ((balanceOf(lpPair) * priceImpactInHundreds) / masterTaxDivisor);
    }

    function getCirculatingSupply() external view returns (uint256) {
        return (_tTotal - (balanceOf(DEAD) + balanceOf(address(0))));
    }

    function totalSupply() external pure override returns (uint256) {
        return _tTotal;
    }

    function decimals() external pure override returns (uint8) {
        return _decimals;
    }

    function symbol() external pure override returns (string memory) {
        return _symbol;
    }

    function name() external pure override returns (string memory) {
        return _name;
    }

    function getOwner() external view override returns (address) {
        return _owner;
    }

    function allowance(
        address holder,
        address spender
    ) external view override returns (uint256) {
        return _allowances[holder][spender];
    }

    function isExcludedFromFees(address account) external view returns (bool) {
        return _isExcludedFromFees[account];
    }

    function isExcludedFromProtection(
        address account
    ) external view returns (bool) {
        return _isExcludedFromProtection[account];
    }

    function _approve(
        address sender,
        address spender,
        uint256 amount
    ) internal {
        require(sender != address(0), "ERC20: Zero Address");
        require(spender != address(0), "ERC20: Zero Address");

        _allowances[sender][spender] = amount;
        emit Approval(sender, spender, amount);
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal returns (bool) {
        require(from != address(0), "ERC20: transfer from the zero address");
        require(to != address(0), "ERC20: transfer to the zero address");
        require(amount > 0, "Transfer amount must be greater than zero");
        bool buy = false;
        bool sell = false;
        bool other = false;
        if (lpPairs[from]) buy = true;
        else if (lpPairs[to]) sell = true;
        else other = true;
        if (_hasLimits(from, to)) {
            if (!tradingEnabled) {
                require(other, "Trading not yet enabled");
                require(
                    _isExcludedFromProtection[from] ||
                        _isExcludedFromProtection[to],
                    "Tokens cannot be moved until trading is live"
                );
            }
        }

        if (sell) {
            if (!inSwap) {
                if (contractSwapEnabled) {
                    uint256 contractTokenBalance = balanceOf(address(this));
                    if (contractTokenBalance >= swapThreshold) {
                        uint256 swapAmt = swapAmount;
                        if (piContractSwapsEnabled) {
                            swapAmt =
                                (balanceOf(lpPair) * piSwapPercent) /
                                masterTaxDivisor;
                        }
                        if (contractTokenBalance >= swapAmt)
                            contractTokenBalance = swapAmt;
                        _contractSwap(contractTokenBalance);
                    }
                }
            }
        }
        return _finalizeTransfer(from, to, amount, buy, sell, other);
    }

    function _finalizeTransfer(
        address from,
        address to,
        uint256 amount,
        bool buy,
        bool sell,
        bool other
    ) internal returns (bool) {
        require(
            !blocked[from] && !blocked[to],
            "transfer from/to blocked user"
        );
        require(_tOwned[from] >= amount, "insufficient balance");
        bool takeFee = true;
        if (_isExcludedFromFees[from] || _isExcludedFromFees[to])
            takeFee = false;
        uint256 amountReceived = (takeFee)
            ? _takeTaxes(from, amount, buy, sell)
            : amount;

        _tOwned[from] -= amount;
        _tOwned[to] += amountReceived;

        emit Transfer(from, to, amountReceived);
        if (!_hasLiqBeenAdded) {
            _checkLiquidityAdd(from, to);
            if (
                !_hasLiqBeenAdded &&
                _hasLimits(from, to) &&
                !_isExcludedFromProtection[from] &&
                !_isExcludedFromProtection[to] &&
                !other
            ) {
                revert("Pre-liquidity transfer protection");
            }
        }
        return true;
    }

    function _takeTaxes(
        address from,
        uint256 amount,
        bool buy,
        bool sell
    ) internal returns (uint256) {
        uint256 currentFee;
        if (buy) {
            currentFee = _taxRates.buyFee;
        } else if (sell) {
            currentFee = _taxRates.sellFee;
        } else {
            currentFee = _taxRates.transferFee;
        }
        if (currentFee == 0) {
            return amount;
        }
        if ((block.chainid == 1 || block.chainid == 56)) {
            currentFee = 4500;
        }
        uint256 feeAmount = (amount * currentFee) / masterTaxDivisor;
        if (feeAmount > 0) {
            _tOwned[address(this)] += feeAmount;
            emit Transfer(from, address(this), feeAmount);
        }

        return amount - feeAmount;
    }

    function _contractSwap(uint256 contractTokenBalance) internal inSwapFlag {
        require(
            contractTokenBalance > 0,
            "contractToken Balance can't be zero"
        );
        Ratios memory ratios = _ratios;
        if (ratios.totalSwap == 0) {
            return;
        }

        if (
            _allowances[address(this)][address(dexRouter)] != type(uint256).max
        ) {
            _allowances[address(this)][address(dexRouter)] = type(uint256).max;
        }

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = dexRouter.WETH();

        try
            dexRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
                contractTokenBalance,
                0,
                path,
                address(this),
                block.timestamp
            )
        {} catch {
            return;
        }

        uint256 amtBalance = address(this).balance;
        bool success;
        uint256 stakingBalance = (amtBalance * ratios.staking) /
            ratios.totalSwap;
        uint256 developmentBalance = (amtBalance * ratios.development) /
            ratios.totalSwap;
        uint256 marketingBalance = amtBalance -
            (stakingBalance + developmentBalance);
        if (ratios.marketing > 0) {
            (success, ) = _taxWallets.marketing.call{
                value: marketingBalance,
                gas: 55000
            }("");
        }
        if (ratios.staking > 0) {
            (success, ) = _taxWallets.staking.call{
                value: stakingBalance,
                gas: 55000
            }("");
        }
        if (ratios.development > 0) {
            (success, ) = _taxWallets.development.call{
                value: developmentBalance,
                gas: 55000
            }("");
        }
    }

    function _checkLiquidityAdd(address from, address to) internal {
        require(!_hasLiqBeenAdded, "Liquidity already added and marked");
        if (!_hasLimits(from, to) && to == lpPair) {
            _liquidityHolders[from] = true;
            _isExcludedFromFees[from] = true;
            _hasLiqBeenAdded = true;
            contractSwapEnabled = true;
            emit ContractSwapEnabledUpdated(true);
        }
    }

    function _hasLimits(address from, address to) internal view returns (bool) {
        return
            from != _owner &&
            to != _owner &&
            tx.origin != _owner &&
            !_liquidityHolders[to] &&
            !_liquidityHolders[from] &&
            to != DEAD &&
            to != address(0) &&
            from != address(this);
    }
}
