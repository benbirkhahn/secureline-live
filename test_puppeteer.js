const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:8080/');
  await new Promise(r => setTimeout(r, 2000));

  const content = await page.evaluate(() => {
    return {
        airportChipsLength: document.getElementById('airport-chips')?.innerHTML.length
    };
  });
  console.log('DOM State:', content);

  await browser.close();
})();
