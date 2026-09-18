from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page()
 page.goto('http://localhost:8000')
 page.clock.install()
 assert page.locator('#returnSeconds').input_value()=='3'
 values=page.evaluate('''async()=>{const m=await import('./motion.js?v=body-2');return [0,.09999,.1,.999].map(last=>{let n=0;return m.randomThrow(()=>++n===5?last:.9).name})}''')
 assert values[:2]==['\uB099','\uB099'] and values[2:]==['\uBAA8','\uBAA8'],values
 page.evaluate('Math.random=()=>0')
 page.locator('#classic').click()
 page.locator('#next').click()
 page.locator('#next').click()
 assert page.locator('#resultBadge').inner_text()=='\uB099'
 page.clock.run_for(2990)
 assert page.locator('#result').is_visible()
 page.clock.run_for(20)
 assert page.locator('#capture').is_visible()
 page.locator('#homeButton').click()
 page.locator('#returnSeconds').fill('7')
 page.locator('#timingForm button').click()
 page.reload()
 assert page.locator('#returnSeconds').input_value()=='7'
 page.clock.install()
 page.locator('#samson').click()
 page.locator('#next').click()
 page.locator('#next').click()
 page.clock.run_for(6990)
 assert page.locator('#result').is_visible()
 page.clock.run_for(20)
 assert page.locator('#capture').is_visible()
 print('PASS: traditional fall probability boundaries, fall rendering, default 3-second return, saved 7-second return in Samson, persistence')
 browser.close()
