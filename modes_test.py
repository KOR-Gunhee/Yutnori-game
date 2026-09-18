from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 browser=p.chromium.launch()
 page=browser.new_page()
 errors=[]
 page.on('pageerror',lambda e: errors.append(str(e)))
 page.goto('http://localhost:8000')
 assert page.locator('#home').is_visible()
 page.locator('#setMo').click()
 page.locator('#thresholdInput').fill('300')
 page.locator('#settingsForm button[type=submit]').click()
 page.locator('#setFall').click()
 page.locator('#thresholdInput').fill('400')
 page.locator('#settingsForm button[type=submit]').click()
 assert page.locator('#settingsError').inner_text()
 page.locator('#thresholdInput').fill('45')
 page.locator('#settingsForm button[type=submit]').click()
 page.reload()
 assert '300' in page.locator('#settingsSummary').inner_text()
 assert '45' in page.locator('#settingsSummary').inner_text()
 page.locator('#classic').click()
 assert page.evaluate("document.querySelector('video').srcObject === null")
 page.locator('#next').click()
 assert page.locator('#result').is_visible()
 page.locator('#next').click()
 assert page.locator('#resultBadge').is_visible()
 page.locator('#homeButton').click()
 page.wait_for_timeout(6500)
 assert page.locator('#home').is_visible()
 page.locator('#samson').click()
 page.locator('#homeButton').click()
 page.locator('#resetSettings').click()
 assert '220' in page.locator('#settingsSummary').inner_text()
 data=page.evaluate('''async () => {
 const m=await import('./motion.js');
 const t=m.thresholds();
 const samples=t.map(raw => m.classifyThrow(.1,(raw/.4-18)/65+.000001).name);
 const names=Array.from({length:16},(_,mask)=>{let bit=0;return m.randomThrow(()=> (mask >> bit++ & 1) ? .1:.9).name});
 return {t,samples,counts:names.reduce((a,n)=>(a[n]=(a[n]||0)+1,a),{}),moderate:m.classifyThrow(.15,.5).score};
 }''')
 assert len(set(data['samples']))==5,data
 gaps=[data['t'][i+1]-data['t'][i] for i in range(4)]
 assert all(gaps[i]<gaps[i+1] for i in range(3))
 assert sorted(data['counts'].values())==[1,1,4,4,6]
 assert data['moderate']<50
 page.set_viewport_size({'width':390,'height':844})
 assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
 assert not errors,errors
 print('PASS: home, modes, settings validation/persistence/reset, exponential boundaries, random outcomes, home cancels timer, mobile layout')
 browser.close()
