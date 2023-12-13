// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IStakingV1 {
    function userStakeId(address user) external view returns (uint128);

    function userMapping(
        address user,
        uint128 index
    )
        external
        view
        returns (
            uint32 stakingTime,
            uint32 stakingType,
            uint128 stakedAmount,
            bool claimed
        );

    function transferTokens(address to, uint256 amount) external;
}
