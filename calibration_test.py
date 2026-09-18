from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
 page=browser.new_page()
 stub='''export class FilesetResolver { static async forVisionTasks(){return {}} }
 export class PoseLandmarker {static async createFromOptions(){let n=0;return {detectForVideo(){n++;const step=Math.max(0,n-12);const jump=Math.min(.16,step*.032);const y=.68-Math.min(1,step/6)*.4-jump;const p=Array.from({length:33},()=>({x:.5,y:.3,visibility:1}));p[11].y=p[12].y=.3-jump;p[23].y=p[24].y=.6-jump;p[15].y=p[16].y=y;return {landmarks:[p]};},close(){}};}}'''
 page.route('**/vision_bundle.mjs',lambda route:route.fulfill(body=stub,content_type='text/javascript'))
 page.goto('http://localhost:8000')
 page.locator('#setMo').click()
 page.locator('#measure').click()
 page.wait_for_function("document.querySelector('#settingsDialog').open",timeout=15000)
 assert page.locator('#home').is_visible()
 assert page.evaluate("document.querySelector('video').srcObject === null")
 measured=float(page.locator('#thresholdInput').input_value())
 assert measured>35,measured
 page.locator('#settingsForm button[type=submit]').click()
 assert str(measured) in page.locator('#settingsSummary').inner_text()
 print('PASS: synthetic motion calibration, measured value confirmation/save, camera release')
 browser.close()
