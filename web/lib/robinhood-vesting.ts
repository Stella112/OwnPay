import { parseAbi } from 'viem';
export const rhVestingAbi = parseAbi([
  'function grantCount(address) view returns(uint256)',
  'function grantId(address,uint256) view returns(uint256)',
  'function grants(uint256) view returns(address owner,address asset,uint256 total,uint256 released,uint64 start,uint64 duration)',
  'function claimable(uint256) view returns(uint256)',
  'function claim(uint256)',
]);
