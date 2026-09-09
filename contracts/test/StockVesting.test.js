const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Helpers ---------------------------------------------------------------------

async function deploy(decimals = 18) {
  const [deployer, employer, recipient, other] = await ethers.getSigners();

  const B20 = await ethers.getContractFactory("MockB20");
  const token = await B20.deploy("Apple xStock", "AAPLc", decimals);
  await token.waitForDeployment();

  const Vesting = await ethers.getContractFactory("StockVesting");
  const vesting = await Vesting.deploy();
  await vesting.waitForDeployment();

  return { deployer, employer, recipient, other, token, vesting };
}

// Extract the grant id from the GrantCreated event in a tx receipt (spec C2:
// never infer id as grantCount - 1).
async function grantIdFromReceipt(vesting, tx) {
  const receipt = await tx.wait();
  const iface = vesting.interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "GrantCreated") return parsed.args.id;
    } catch {
      // not our event
    }
  }
  throw new Error("GrantCreated event not found");
}

const memo = ethers.encodeBytes32String("2026 contributor");

// -----------------------------------------------------------------------------

describe("StockVesting", () => {
  describe("createGrant (Pay)", () => {
    it("pulls RAW units into escrow, increments grantCount, and emits GrantCreated with the id", async () => {
      const { employer, recipient, token, vesting } = await deploy();
      const total = 1_000n;
      await token.mint(employer.address, total);
      await token.connect(employer).approve(await vesting.getAddress(), total);

      const now = BigInt(await time.latest());
      const tx = await vesting
        .connect(employer)
        .createGrant(await token.getAddress(), recipient.address, total, now, now + 15n, 60n, true, memo);

      const id = await grantIdFromReceipt(vesting, tx);
      expect(id).to.equal(0n);
      expect(await vesting.grantCount()).to.equal(1n);

      // Tokens are now escrowed in the contract, not with the employer.
      expect(await token.balanceOf(await vesting.getAddress())).to.equal(total);
      expect(await token.balanceOf(employer.address)).to.equal(0n);

      const g = await vesting.grants(id);
      expect(g.total).to.equal(total);
      expect(g.released).to.equal(0n);
      expect(g.revocable).to.equal(true);
      expect(g.to).to.equal(recipient.address);
      expect(g.memo).to.equal(memo);
    });

    it("reverts without prior approval", async () => {
      const { employer, recipient, token, vesting } = await deploy();
      await token.mint(employer.address, 1000n);
      const now = BigInt(await time.latest());
      await expect(
        vesting
          .connect(employer)
          .createGrant(await token.getAddress(), recipient.address, 1000n, now, now + 15n, 60n, true, memo)
      ).to.be.reverted;
    });

    it("rejects malformed schedules", async () => {
      const { recipient, token, vesting } = await deploy();
      const t = await token.getAddress();
      const now = BigInt(await time.latest());
      await expect(vesting.createGrant(t, recipient.address, 0n, now, now, 60n, true, memo)).to.be.revertedWith("total=0");
      await expect(vesting.createGrant(t, recipient.address, 1n, now, now, 0n, true, memo)).to.be.revertedWith("duration=0");
      await expect(vesting.createGrant(t, recipient.address, 1n, now + 10n, now, 60n, true, memo)).to.be.revertedWith("cliff<start");
      await expect(vesting.createGrant(t, recipient.address, 1n, now, now + 100n, 60n, true, memo)).to.be.revertedWith("cliff>end");
    });
  });

  describe("vesting math", () => {
    it("is 0 before cliff, linear after, and full at end", async () => {
      const { employer, recipient, token, vesting } = await deploy();
      const total = 1_000n;
      await token.mint(employer.address, total);
      await token.connect(employer).approve(await vesting.getAddress(), total);

      const start = BigInt(await time.latest()) + 5n;
      const cliff = start + 15n;
      const duration = 100n; // end = start + 100
      const tx = await vesting
        .connect(employer)
        .createGrant(await token.getAddress(), recipient.address, total, start, cliff, duration, true, memo);
      const id = await grantIdFromReceipt(vesting, tx);

      // Before cliff: nothing.
      expect(await vesting.vestedRaw(id)).to.equal(0n);
      expect(await vesting.releasableRaw(id)).to.equal(0n);

      // At start + 50: 50% vested.
      await time.increaseTo(start + 50n);
      const mid = await vesting.vestedRaw(id);
      expect(mid).to.equal((total * 50n) / duration); // 500

      // After end: fully vested.
      await time.increaseTo(start + duration + 1n);
      expect(await vesting.vestedRaw(id)).to.equal(total);
      expect(await vesting.releasableRaw(id)).to.equal(total);
    });
  });

  describe("release", () => {
    it("transfers claimable RAW to the recipient and updates released; immediate re-release reverts", async () => {
      const { employer, recipient, token, vesting } = await deploy();
      const total = 1_000n;
      await token.mint(employer.address, total);
      await token.connect(employer).approve(await vesting.getAddress(), total);

      const start = BigInt(await time.latest());
      const tx = await vesting
        .connect(employer)
        .createGrant(await token.getAddress(), recipient.address, total, start, start, 100n, true, memo);
      const id = await grantIdFromReceipt(vesting, tx);

      await time.increaseTo(start + 100n); // fully vested
      await expect(vesting.connect(recipient).release(id))
        .to.emit(vesting, "Released")
        .withArgs(id, recipient.address, total);

      expect(await token.balanceOf(recipient.address)).to.equal(total);
      const g = await vesting.grants(id);
      expect(g.released).to.equal(total);

      // Nothing left immediately after.
      await expect(vesting.connect(recipient).release(id)).to.be.revertedWith("nothing to release");
    });
  });

  describe("revoke (Pay only)", () => {
    it("returns only the unvested portion to the employer; recipient keeps vested; second revoke reverts", async () => {
      const { employer, recipient, token, vesting } = await deploy();
      const total = 1_000n;
      await token.mint(employer.address, total);
      await token.connect(employer).approve(await vesting.getAddress(), total);

      const start = BigInt(await time.latest());
      const tx = await vesting
        .connect(employer)
        .createGrant(await token.getAddress(), recipient.address, total, start, start, 100n, true, memo);
      const id = await grantIdFromReceipt(vesting, tx);

      // Move to ~40% vested, then revoke.
      await time.increaseTo(start + 40n);
      await vesting.connect(employer).revoke(id);

      const g = await vesting.grants(id);
      expect(g.revoked).to.equal(true);
      expect(g.total).to.be.closeTo(400n, 10n);
      const refunded = await token.balanceOf(employer.address);
      expect(refunded).to.be.closeTo(600n, 10n);

      // Recipient can still claim the vested remainder.
      await vesting.connect(recipient).release(id);
      expect(await token.balanceOf(recipient.address)).to.equal(g.total);

      // Second revoke fails.
      await expect(vesting.connect(employer).revoke(id)).to.be.revertedWith("already revoked");
    });

    it("only the employer can revoke", async () => {
      const { employer, recipient, other, token, vesting } = await deploy();
      await token.mint(employer.address, 100n);
      await token.connect(employer).approve(await vesting.getAddress(), 100n);
      const now = BigInt(await time.latest());
      const tx = await vesting
        .connect(employer)
        .createGrant(await token.getAddress(), recipient.address, 100n, now, now, 100n, true, memo);
      const id = await grantIdFromReceipt(vesting, tx);
      await expect(vesting.connect(other).revoke(id)).to.be.revertedWith("not employer");
    });
  });

  describe("Gift (revocable = false, cliff == end)", () => {
    it("is all-or-nothing at unlock and cannot be revoked", async () => {
      const { employer, recipient, token, vesting } = await deploy();
      const total = 500n;
      await token.mint(employer.address, total);
      await token.connect(employer).approve(await vesting.getAddress(), total);

      const start = BigInt(await time.latest());
      const unlock = start + 60n;
      const duration = unlock - start; // cliff == start + duration == unlock
      const tx = await vesting
        .connect(employer)
        .createGrant(await token.getAddress(), recipient.address, total, start, unlock, duration, false, memo);
      const id = await grantIdFromReceipt(vesting, tx);

      // Before unlock: nothing vested.
      await time.increaseTo(unlock - 5n);
      expect(await vesting.vestedRaw(id)).to.equal(0n);

      // At/after unlock: full amount.
      await time.increaseTo(unlock + 1n);
      expect(await vesting.vestedRaw(id)).to.equal(total);

      // Not revocable.
      await expect(vesting.connect(employer).revoke(id)).to.be.revertedWith("not revocable");
    });
  });

  describe("B20 multiplier invariance (spec A2/A5/C5)", () => {
    it("keeps RAW accounting unchanged when the multiplier changes; only scaled display moves", async () => {
      const { employer, recipient, token, vesting } = await deploy();
      const total = 1_000n;
      await token.mint(employer.address, total);
      await token.connect(employer).approve(await vesting.getAddress(), total);

      const start = BigInt(await time.latest());
      const tx = await vesting
        .connect(employer)
        .createGrant(await token.getAddress(), recipient.address, total, start, start, 100n, true, memo);
      const id = await grantIdFromReceipt(vesting, tx);

      // Fully vest first, so the raw amount is pinned at `total` and cannot drift
      // with time — this isolates the multiplier as the only variable under test.
      await time.increaseTo(start + 100n);
      const rawBefore = await vesting.vestedRaw(id);
      expect(rawBefore).to.equal(total);

      // A corporate action changes the multiplier to 1.5x.
      await token.setMultiplier(ethers.parseUnits("1.5", 18));

      // RAW vested is unchanged — fund accounting is multiplier-independent.
      expect(await vesting.vestedRaw(id)).to.equal(rawBefore);
      expect((await vesting.grants(id)).total).to.equal(total);

      // The display helper scales by the multiplier: 1000 raw -> 1500 UI.
      const scaled = await vesting.releasableShares(id);
      expect(scaled).to.equal((rawBefore * 15n) / 10n);
    });
  });

  describe("tipWithMemo fallback", () => {
    it("moves RAW units and emits MemoTransfer", async () => {
      const { employer, recipient, token, vesting } = await deploy();
      await token.mint(employer.address, 100n);
      await token.connect(employer).approve(await vesting.getAddress(), 100n);
      await expect(
        vesting.connect(employer).tipWithMemo(await token.getAddress(), recipient.address, 40n, memo)
      )
        .to.emit(vesting, "MemoTransfer")
        .withArgs(await token.getAddress(), employer.address, recipient.address, 40n, memo);
      expect(await token.balanceOf(recipient.address)).to.equal(40n);
    });
  });

  describe("non-18 decimals", () => {
    it("vesting is unaffected by token decimals (all raw)", async () => {
      const { employer, recipient, token, vesting } = await deploy(6);
      expect(await token.decimals()).to.equal(6n);
      const total = 12_345n;
      await token.mint(employer.address, total);
      await token.connect(employer).approve(await vesting.getAddress(), total);
      const start = BigInt(await time.latest());
      const tx = await vesting
        .connect(employer)
        .createGrant(await token.getAddress(), recipient.address, total, start, start, 100n, true, memo);
      const id = await grantIdFromReceipt(vesting, tx);
      await time.increaseTo(start + 100n);
      expect(await vesting.vestedRaw(id)).to.equal(total);
    });
  });
});
