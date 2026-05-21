const fs = require('fs');
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  const svgContent = fs.readFileSync('build/icon.svg', 'utf8');
  
  // Set content to HTML with the SVG
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body style="margin: 0; padding: 0; background: transparent;">
        ${svgContent}
      </body>
    </html>
  `);
  
  // Set viewport to SVG size
  await page.setViewport({ width: 1024, height: 1024 });
  
  // Take screenshot
  const svgElement = await page.$('svg');
  await svgElement.screenshot({ path: 'build/icon.png', omitBackground: true });
  
  await browser.close();
  console.log('PNG generated');
})();
