import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/static',outputDir:'./test-results/static-browser',timeout:60000,workers:1,
 projects:[
  {name:'root',grep:/cleanup at \/$/},
  {name:'subpath',grep:/cleanup at \/deep/},
  {name:'missing-asset',grep:/missing asset/},
  {name:'truncated',grep:/truncated deployment/},
  {name:'cancel-download',grep:/cancel downloading/},
  {name:'cancel-initialize',grep:/cancel iframe/},
  {name:'aspect-diagnostic',grep:/fixed aspect/},
 ],
 reporter:[['list'],['json',{outputFile:'docs/verification/f13-static-browser.json'}]],
 use:{baseURL:'http://127.0.0.1:5197',viewport:{width:1280,height:850},trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
 webServer:{command:'node scripts/prepare-static-tests.mjs && node scripts/serve-static.mjs .static-test-fixtures/served 5197',url:'http://127.0.0.1:5197',timeout:30000,reuseExistingServer:false},
});
