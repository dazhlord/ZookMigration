// SPDX-License-Identifier: MIT
pragma solidity >=0.6.0 <0.9.0;

interface Initializer {
    function setLaunch(address _initialLpPair, uint32 _liqAddBlock, uint64 _liqAddStamp, uint8 dec) external;
    function getConfig() external returns (address, address);
    function getInits(uint256 amount) external returns (uint256, uint256);
    function setLpPair(address pair, bool enabled) external;
}