# Vendor Flips for WoW Forever

**[Open the site](https://star-in-a-galaxy.github.io/vendor_flips/)**

Finds crafts in World of Warcraft: Forever that a vendor buys for more than their materials cost,
and gives you the shopping list.

## How to use it

1. Pick your **Market** at the top: region, ruleset and faction.
2. The list shows every craft that makes money right now, best first. Click a column to sort.
3. Click a flip to see what to buy, where (auction house or vendor), and how many.
4. Under **More filters**, enter your skill per profession to hide recipes you can't make yet, or
   set a minimum margin or profit.

Have Honored reputation or Legacy Bartering? Set it at the top, and vendor materials get cheaper.

## Good to know

- Auction prices come from [ahprice.com](https://ahprice.com) and refresh every 30 minutes.
  The site shows the time of its last update.
- Per hour assumes you craft back to back. Buying materials and visiting the vendor don't count.
- Check the auction house before you buy. A cheap listing may be gone, or have only a few units.

## Development

`npm start` runs the site locally. `npm test` runs the tests. See [DEVELOPMENT.md](DEVELOPMENT.md)
for data updates and how the numbers are worked out.

Unofficial fan tool. World of Warcraft and Blizzard are trademarks of Blizzard Entertainment, Inc.
