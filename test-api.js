const { IgApiClient } = require("instagram-private-api");
const config = require('./config');

(async () => {
  const ig = new IgApiClient();
  
  console.log('🔍 API 테스트 시작\n');
  
  try {
    console.log('1️⃣ 로그인 중...');
    ig.state.generateDevice(config.username);
    const user = await ig.account.login(config.username, config.password);
    console.log(`✅ 로그인 성공: @${user.username}\n`);
    
    console.log('⏳ 2초 대기 중...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('2️⃣ directInbox() 호출 테스트...');
    const inboxFeed = ig.feed.directInbox();
    console.log('   inboxFeed 생성 완료');
    
    console.log('3️⃣ items() 호출 테스트...');
    const threads = await inboxFeed.items();
    console.log(`✅ 성공! ${threads ? threads.length : 0}개의 스레드를 가져왔습니다.\n`);
    
    if (threads && threads.length > 0) {
      console.log('📋 첫 번째 스레드 정보:');
      const firstThread = threads[0];
      console.log(`   Thread ID: ${firstThread.thread_id || firstThread.thread_v2_id || firstThread.id}`);
      console.log(`   사용자 수: ${firstThread.users ? firstThread.users.length : 0}`);
      if (firstThread.users && firstThread.users.length > 0) {
        console.log(`   첫 번째 사용자: @${firstThread.users[0].username || '알 수 없음'}`);
      }
    }
    
    console.log('\n✅ API 테스트 완료!');
    
  } catch (error) {
    console.error('\n❌ API 테스트 실패:');
    console.error(`   에러 타입: ${error.constructor?.name || '알 수 없음'}`);
    console.error(`   메시지: ${error.message || '알 수 없음'}`);
    
    if (error.response) {
      console.error(`   HTTP 상태: ${error.response.status || '알 수 없음'} ${error.response.statusText || ''}`);
      if (error.response.body) {
        try {
          const bodyStr = typeof error.response.body === 'string' 
            ? error.response.body 
            : JSON.stringify(error.response.body);
          console.error(`   응답 본문: ${bodyStr.substring(0, 500)}`);
        } catch (e) {
          console.error(`   응답 본문: (파싱 실패)`);
        }
      }
    }
    
    if (error.statusCode) {
      console.error(`   상태 코드: ${error.statusCode}`);
    }
    if (error.status) {
      console.error(`   상태: ${error.status}`);
    }
    if (error.text) {
      console.error(`   에러 텍스트: ${error.text.substring(0, 500)}`);
    }
    
    console.error(`\n   전체 에러 객체:`);
    console.error(JSON.stringify(error, Object.getOwnPropertyNames(error), 2).substring(0, 1000));
  }
  
  process.exit(0);
})();

