# Workflow Node Reference

> This file is auto-generated from `backend/src/web3/nodes/node-registry.ts` and node `description` schemas.
> Regenerate with `npm run docs:nodes` from the `backend/` directory.

Total nodes: **11**

## Node Index

| Type | Display Name | Group | Trigger | Telegram Notify | Inputs | Outputs |
| --- | --- | --- | --- | --- | --- | --- |
| `driftPerp` | [Drift Perpetual](#node-driftperp) | `defi` | No | Yes | `main` | `main` |
| `getBalance` | [Get Balance](#node-getbalance) | `query` | No | No | `main` | `main` |
| `heliusWebhook` | [Helius Webhook](#node-heliuswebhook) | `trigger` | Yes | No | `main` | `main` |
| `jupiterLimitOrder` | [Jupiter Limit Order](#node-jupiterlimitorder) | `swap` | No | Yes | `main` | `main` |
| `jupiterSwap` | [Jupiter Swap](#node-jupiterswap) | `swap` | No | Yes | `main` | `main` |
| `kamino` | [Kamino](#node-kamino) | `vault` | No | Yes | `main` | `main` |
| `luloLend` | [Lulo Lending](#node-lulolend) | `defi` | No | Yes | `main` | `main` |
| `pythPriceFeed` | [Pyth Price Feed](#node-pythpricefeed) | `trigger` | Yes | Yes | `main` | `main` |
| `sanctumLst` | [Sanctum LST](#node-sanctumlst) | `defi` | No | Yes | `main` | `main` |
| `stakeSOL` | [Stake SOL](#node-stakesol) | `defi` | No | Yes | `main` | `main` |
| `transfer` | [Transfer](#node-transfer) | `transfer` | No | Yes | `main` | `main` |

<a id="node-driftperp"></a>

## Drift Perpetual (`driftPerp`)

Trade perpetual contracts on Drift Protocol using Crossmint custodial wallet

- Group: `defi`
- Trigger Node: No
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to use for trading (uses Crossmint custodial wallet) | - |
| `operation` | `options` | `openLong` | The operation to perform | `openLong` (Open Long)<br/>`openShort` (Open Short)<br/>`close` (Close Position)<br/>`fundingRate` (Get Funding Rate) |
| `market` | `string` | `SOL-PERP` | Perpetual market (e.g., SOL-PERP, BTC-PERP, ETH-PERP) | - |
| `amount` | `string` | `""` | Position size in USD (for open operations) | - |
| `leverage` | `string` | `1` | Leverage multiplier (1-20x) | - |
| `orderType` | `options` | `market` | Order type | `market` (Market)<br/>`limit` (Limit) |
| `limitPrice` | `string` | `""` | Limit price (only for limit orders) | - |


<a id="node-getbalance"></a>

## Get Balance (`getBalance`)

Query SOL or SPL token balance for an account

- Group: `query`
- Trigger Node: No
- Telegram Notify: No
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to query balance (uses Crossmint custodial wallet) | - |
| `token` | `string` | `SOL` | Token to query (e.g., SOL, USDC). See src/web3/constants.ts for available tokens. | - |
| `condition` | `options` | `none` | Optional condition to check. If condition fails, subsequent nodes will not execute. | `none` (None (always pass))<br/>`gt` (Greater than)<br/>`lt` (Less than)<br/>`eq` (Equal to)<br/>`gte` (Greater or equal)<br/>`lte` (Less or equal) |
| `threshold` | `string` | `0` | Threshold amount for condition check (human readable) | - |


<a id="node-heliuswebhook"></a>

## Helius Webhook (`heliusWebhook`)

Create and manage Helius webhooks for on-chain event monitoring

- Group: `trigger`
- Trigger Node: Yes
- Telegram Notify: No
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `operation` | `options` | `create` | The operation to perform | `create` (Create Webhook)<br/>`get` (Get Webhook)<br/>`delete` (Delete Webhook)<br/>`list` (List All Webhooks) |
| `webhookId` | `string` | `""` | Webhook ID (for get/delete operations) | - |
| `webhookUrl` | `string` | `""` | URL to receive webhook notifications (for create operation) | - |
| `accountAddresses` | `string` | `""` | Comma-separated list of account addresses to monitor (for create operation) | - |
| `transactionTypes` | `string` | `ANY` | Comma-separated transaction types to monitor (SWAP, TRANSFER, NFT_SALE, ANY, etc.) | - |
| `webhookType` | `options` | `enhanced` | Type of webhook | `enhanced` (Enhanced (Parsed))<br/>`raw` (Raw)<br/>`discord` (Discord)<br/>`enhancedDevnet` (Enhanced Devnet)<br/>`rawDevnet` (Raw Devnet) |


<a id="node-jupiterlimitorder"></a>

## Jupiter Limit Order (`jupiterLimitOrder`)

Create a limit order on Jupiter using Crossmint custodial wallet

- Group: `swap`
- Trigger Node: No
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to use for the limit order (uses Crossmint custodial wallet) | - |
| `inputToken` | `string` | `USDC` | Token to sell (e.g., USDC, SOL) | - |
| `outputToken` | `string` | `SOL` | Token to buy (e.g., SOL, USDC) | - |
| `inputAmount` | `string` | `""` | Amount of input token to sell (human readable, minimum ~5 USD) | - |
| `targetPrice` | `string` | `""` | Target price (output tokens per input token) | - |
| `expiryHours` | `string` | `24` | Order expiry time in hours (default: 24) | - |


<a id="node-jupiterswap"></a>

## Jupiter Swap (`jupiterSwap`)

Swap tokens using Jupiter aggregator with Crossmint custodial wallet

- Group: `swap`
- Trigger Node: No
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to use for the swap (uses Crossmint custodial wallet) | - |
| `inputToken` | `string` | `USDC` | Input token ticker (e.g., USDC, SOL, JITOSOL). See src/web3/constants.ts for available tokens. | - |
| `outputToken` | `string` | `SOL` | Output token ticker (e.g., SOL, USDC, JITOSOL). See src/web3/constants.ts for available tokens. | - |
| `amount` | `string` | `auto` | Amount to swap. Use "auto" to use output from previous node, "all" for all input amount, "half" for half, or specify a number (e.g., 1, 0.5, 100) | - |
| `slippageBps` | `string` | `50` | Slippage tolerance in basis points (50 = 0.5%) | - |


<a id="node-kamino"></a>

## Kamino (`kamino`)

Interact with Kamino vaults using Crossmint custodial wallet - deposit or withdraw tokens

- Group: `vault`
- Trigger Node: No
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to use (uses Crossmint custodial wallet) | - |
| `operation` | `options` | `deposit` | The operation to perform | `deposit` (Deposit)<br/>`withdraw` (Withdraw) |
| `vaultName` | `string` | `""` | The name of the Kamino vault (e.g., USDC_Prime, MEV_Capital_SOL) | - |
| `amount` | `string` | `auto` | Amount to deposit. Use "auto" to use output from previous node, "all" for all input amount, "half" for half, or specify a number (for deposit operation) | - |
| `shareAmount` | `string` | `all` | Share amount to withdraw. Use "all" to withdraw all shares, "half" for half, or specify a number (for withdraw operation) | - |


<a id="node-lulolend"></a>

## Lulo Lending (`luloLend`)

Lend assets on Lulo for yield using Crossmint custodial wallet

- Group: `defi`
- Trigger Node: No
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to use (uses Crossmint custodial wallet) | - |
| `operation` | `options` | `deposit` | The operation to perform | `deposit` (Deposit (Lend))<br/>`withdraw` (Withdraw)<br/>`info` (Get Account Info) |
| `token` | `string` | `USDC` | Token to lend/withdraw (e.g., USDC, SOL) | - |
| `amount` | `string` | `auto` | Amount to deposit/withdraw. Use "auto" for previous node output, "all" for entire balance, or a number | - |


<a id="node-pythpricefeed"></a>

## Pyth Price Feed (`pythPriceFeed`)

Monitor token price and trigger workflow when target price is reached

- Group: `trigger`
- Trigger Node: Yes
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `ticker` | `options` | `""` | Pyth price feed ID to monitor (e.g., SOL/USD feed ID) | `4` (4)<br/>`0G` (0G)<br/>`1INCH` (1INCH)<br/>`2Z` (2Z)<br/>`A` (A)<br/>`AAPLX` (AAPLX)<br/>`AAVE` (AAVE)<br/>`ACT` (ACT)<br/>`ADA` (ADA)<br/>`AERGO` (AERGO)<br/>`AERO` (AERO)<br/>`AEVO` (AEVO)<br/>`AFSUI` (AFSUI)<br/>`AI16Z` (AI16Z)<br/>`AIXBT` (AIXBT)<br/>`AKT` (AKT)<br/>`ALGO` (ALGO)<br/>`ALICE` (ALICE)<br/>`ALKIMI` (ALKIMI)<br/>`ALT` (ALT)<br/>... and 552 more options |
| `targetPrice` | `string` | `0` | Target price to trigger the workflow | - |
| `condition` | `options` | `above` | Price condition to trigger | `above` (Above)<br/>`below` (Below)<br/>`equal` (Equal) |
| `hermesEndpoint` | `string` | `https://hermes.pyth.network` | Pyth Hermes endpoint URL | - |


<a id="node-sanctumlst"></a>

## Sanctum LST (`sanctumLst`)

Swap Liquid Staking Tokens (LST) on Sanctum using Crossmint custodial wallet

- Group: `defi`
- Trigger Node: No
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to use (uses Crossmint custodial wallet) | - |
| `operation` | `options` | `swap` | The operation to perform | `swap` (Swap LST)<br/>`apy` (Get APY)<br/>`quote` (Get Quote) |
| `inputLst` | `string` | `SOL` | Input LST (SOL, mSOL, bSOL, jitoSOL, jupSOL, etc.) | - |
| `outputLst` | `string` | `jitoSOL` | Output LST (SOL, mSOL, bSOL, jitoSOL, jupSOL, etc.) | - |
| `amount` | `string` | `auto` | Amount to swap. Use "auto" for previous node output, "all" for entire balance, or a number | - |
| `priorityFee` | `string` | `5000` | Priority fee in lamports (default: 5000) | - |


<a id="node-stakesol"></a>

## Stake SOL (`stakeSOL`)

Stake SOL for jupSOL using Jupiter staking (liquid staking with Crossmint wallet)

- Group: `defi`
- Trigger Node: No
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to use (uses Crossmint custodial wallet) | - |
| `operation` | `options` | `stake` | The operation to perform | `stake` (Stake SOL → jupSOL)<br/>`unstake` (Unstake jupSOL → SOL)<br/>`info` (Get Staking Info) |
| `amount` | `string` | `auto` | Amount to stake/unstake. Use "auto" for previous node output, "all" for entire balance, or a number (minimum 0.1 SOL) | - |


<a id="node-transfer"></a>

## Transfer (`transfer`)

Transfer SOL or SPL tokens to a recipient address using Crossmint custodial wallet

- Group: `transfer`
- Trigger Node: No
- Telegram Notify: Yes
- Inputs: `main`
- Outputs: `main`

### Parameters

| Name | Type | Default | Description | Options |
| --- | --- | --- | --- | --- |
| `accountId` | `string` | `""` | Account ID to use for the transfer (uses Crossmint custodial wallet) | - |
| `recipient` | `string` | `""` | Recipient wallet address | - |
| `token` | `string` | `SOL` | Token to transfer (e.g., SOL, USDC). See src/web3/constants.ts for available tokens. | - |
| `amount` | `string` | `""` | Amount to transfer (human readable, e.g., 1.5 SOL or 100 USDC) | - |

