// Read-only: fetches quotes, never signs, approves, or submits orders.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FROM = "0x0000000000000000000000000000000000000001";
const stocks = {
  NVDAc: "0xb20000000000000000000078ee7ce2fE4908108C",
  AAPLc: "0xb200000000000000000000C2e324d24d7eEcd1fb",
};

async function json(url, options = {}) {
  const started = Date.now();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  return { status: response.status, ms: Date.now() - started, body };
}

async function quote(venue, symbol, token, amount) {
  const raw = (BigInt(amount) * 1000000n).toString();
  try {
    let result;
    if (venue === "KyberSwap") {
      const params = new URLSearchParams({ tokenIn: USDC, tokenOut: token, amountIn: raw });
      const { status, ms, body } = await json(`https://aggregator-api.kyberswap.com/base/api/v1/routes?${params}`, { headers: { "x-client-id": "OwnPay" } });
      const summary = body.data?.routeSummary;
      result = { status, ms, code: body.code, amountOut: summary?.amountOut, gasUSD: summary?.gasUsd, router: body.data?.routerAddress, sources: summary?.route?.flat().map((step) => step.exchange), message: summary ? undefined : body.message };
    } else if (venue === "LI.FI") {
      const params = new URLSearchParams({ fromChain: "8453", toChain: "8453", fromToken: USDC, toToken: token, fromAmount: raw, fromAddress: FROM, toAddress: FROM, slippage: "0.01", integrator: "ownpay", order: "CHEAPEST" });
      const { status, ms, body } = await json(`https://li.quest/v1/quote?${params}`);
      result = { status, ms, amountOut: body.estimate?.toAmount, minOut: body.estimate?.toAmountMin, gasUSD: body.estimate?.gasCosts?.reduce((sum, fee) => sum + Number(fee.amountUSD || 0), 0), fees: body.estimate?.feeCosts?.map((fee) => ({ name: fee.name, usd: fee.amountUSD })), sources: [body.tool], router: body.transactionRequest?.to, message: body.estimate ? undefined : body.message, code: body.code };
    } else {
      const { status, ms, body } = await json("https://api.cow.fi/base/api/v1/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sellToken: USDC, buyToken: token, sellAmountBeforeFee: raw, kind: "sell", from: FROM, receiver: FROM, priceQuality: "fast" }) });
      result = { status, ms, amountOut: body.quote?.buyAmount, feeRaw: body.quote?.feeAmount, sellRaw: body.quote?.sellAmount, verified: body.verified, message: body.description, code: body.errorType };
    }
    console.log(JSON.stringify({ venue, symbol, usdc: amount, ...result }));
  } catch (error) { console.log(JSON.stringify({ venue, symbol, usdc: amount, error: error.name })); }
}

// Keep concurrency modest: three independent providers per asset/amount.
for (const amount of ["1", "10", "100"]) {
  for (const [symbol, token] of Object.entries(stocks)) {
    await Promise.all(["KyberSwap", "LI.FI", "CoW"].map((venue) => quote(venue, symbol, token, amount)));
  }
}
