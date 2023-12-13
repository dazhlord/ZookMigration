// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockZook is ERC20, Ownable {
    constructor() ERC20("ZookV2","$zook") Ownable(msg.sender){
    }
    function mint(address to, uint256 amount) public onlyOwner{
        _mint(to, amount);
    }
}