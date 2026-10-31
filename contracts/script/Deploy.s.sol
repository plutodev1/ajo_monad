// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AjoBook} from "../src/AjoBook.sol";
import {AjoCircle} from "../src/AjoCircle.sol";
import {IERC20} from "../src/SafeToken.sol";

/// @notice Deploys the dues book and the Esusu circles contract against one stablecoin.
///         Env: COMMUNITY_NAME (default "ChainConnect NG"), USDC (defaults to Circle's
///         USDC on Arbitrum Sepolia, or on Arbitrum One when chain id is 42161).
contract Deploy is Script {
    address constant USDC_ARBITRUM_SEPOLIA = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;
    address constant USDC_ARBITRUM_ONE = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    function run() external {
        string memory community = vm.envOr("COMMUNITY_NAME", string("ChainConnect NG"));
        address usdc = vm.envOr(
            "USDC", block.chainid == 42161 ? USDC_ARBITRUM_ONE : USDC_ARBITRUM_SEPOLIA
        );

        vm.startBroadcast();
        AjoBook book = new AjoBook(community, IERC20(usdc));
        AjoCircle circles = new AjoCircle(IERC20(usdc));
        vm.stopBroadcast();

        console2.log("USDC      ", usdc);
        console2.log("AjoBook   ", address(book));
        console2.log("AjoCircle ", address(circles));
    }
}
