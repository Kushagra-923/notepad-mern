// Browser tests: needs `npm run build` first and a Chrome/Chromium (set CHROME_PATH if not at /usr/bin/google-chrome)
import sharing from './sharing.e2e.mjs'
import teams from './teams.e2e.mjs'
import richtext from './richtext.e2e.mjs'
import errors from './errors.e2e.mjs'

let failed = 0
for (const run of [sharing, teams, richtext, errors]) failed += await run()
console.log(failed ? `\n${failed} check(s) failed` : '\nAll browser checks passed')
process.exit(failed ? 1 : 0)
