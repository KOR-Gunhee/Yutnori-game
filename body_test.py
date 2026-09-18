from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('http://localhost:8000')
    result = page.evaluate('''async () => {
      const m = await import('./motion.js?v=body-1');
      function run(kind, mode='samson') {
        const tracker = new m.MotionTracker();
        for (let n=0;n<55;n++) {
          const step = Math.max(0,n-12);
          const arm = Math.min(1,step/6);
          const jump = kind==='jump' ? Math.min(.16,step*.032) : kind==='small' ? Math.min(.045,step*.009) : 0;
          const spike = kind==='spike' && n===15 ? .16 : 0;
          const shoulderOnly = kind==='shrug' ? Math.min(.10,step*.02) : 0;
          const pts=Array.from({length:33},()=>({x:.5,y:.3,visibility:1}));
          pts[11].y=pts[12].y=.3-jump-spike-shoulderOnly;
          pts[23].y=pts[24].y=.6-jump-spike;
          pts[15].y=pts[16].y=.68-arm*.4-jump;
          if(kind==='missing') pts[23].visibility=.1;
          const out=tracker.update(pts,n*70,m.DEFAULT_SETTINGS,mode);
          if(out.result)return out.result;
        }
        return null;
      }
      const weak=run('arms'), strong=run('jump'), small=run('small'), shrug=run('shrug'), spike=run('spike');
      const classicWeak=run('arms','classic'), classicStrong=run('jump','classic');
      const outcomes=[weak,strong].map(motion=>Array.from({length:16},(_,mask)=>{
        let bit=0;return m.resolveThrow('classic',motion,()=> (mask>>bit++ & 1)? .1:.9).name;
      }));
      return {weak,strong,small,shrug,spike,missing:run('missing'),classicWeak,classicStrong,outcomes};
    }''')
    assert result['weak']['name'] == '\uB099', result
    assert result['strong']['name'] != '\uB099', result
    assert result['strong']['raw'] > result['small']['raw'] > result['weak']['raw'], result
    assert result['shrug'] is None or result['shrug']['name'] == '\uB099', result
    assert result['spike']['name'] == '\uB099', result
    assert result['missing'] is None, result
    assert result['classicWeak']['triggered'] and result['classicStrong']['triggered'], result
    assert result['outcomes'][0] == result['outcomes'][1], result
    assert len(set(result['outcomes'][0])) == 5, result
    page.locator('#classic').click()
    assert page.locator('.power').is_hidden()
    assert page.locator('#classicNotice').is_visible()
    page.locator('#next').click()
    assert page.locator('#result').is_visible()
    page.locator('#homeButton').click()
    page.locator('#samson').click()
    assert page.locator('.power').is_visible()
    assert page.locator('#classicNotice').is_hidden()
    print('PASS: arms-only/shrug/spike rejected, body rise scored, weak/strong classic outcomes identical for all 16 draws, missing hips reset, mode UI')
    print({key: (result[key] or {}).get('raw') for key in ['weak','small','strong','shrug','spike']})
    browser.close()
