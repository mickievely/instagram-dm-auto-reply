const config = require('./config');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { IgApiClient } = require('instagram-private-api');
const { IgLoginRequiredError, IgCheckpointError, IgResponseError } = require('instagram-private-api/dist/errors');

class DMExtractor {
  constructor() {
    this.ig = new IgApiClient();
    this.sessionPath = path.join(__dirname, 'sessions');
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
    this.sessionFile = path.join(this.sessionPath, `${config.username || 'session'}.json`);
  }

  async saveSession() {
    try {
      const sessionData = await this.ig.state.serialize();
      fs.writeFileSync(this.sessionFile, JSON.stringify(sessionData, null, 2));
    } catch (error) {
    }
  }

  async loadSession() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const sessionData = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        
        if (!sessionData.deviceString || !sessionData.deviceId) {
          const username = config.username;
          if (username) {
            this.ig.state.generateDevice(username);
          }
        }
        
        await this.ig.state.deserialize(sessionData);
        console.log('📂 저장된 세션 불러오기 완료');
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async login() {
    try {
      const username = config.username;
      const password = config.password;

      if (!username || !password) {
        throw new Error('.env에 IG_USERNAME, IG_PASSWORD를 설정해주세요.');
      }

      this.ig.state.generateDevice(username);
      const user = await this.ig.account.login(username, password);
      console.log(`✅ 로그인 성공: @${user.username}`);
      
      return user;
    } catch (error) {
      if (error instanceof IgLoginRequiredError) {
        console.error('❌ 로그인 실패: 인증이 필요합니다. 2단계 인증이 활성화되어 있나요?');
      } else if (error instanceof IgCheckpointError) {
        console.error('❌ 로그인 실패: Instagram이 보안 검증을 요청했습니다.');
        console.error('💡 해결 방법:');
        console.error('   1. Instagram 앱에서 로그인하여 보안 검증을 완료하세요.');
        console.error('   2. 잠시 후 다시 시도하세요.');
      } else {
        console.error('❌ 로그인 실패:', error.message);
      }
      throw error;
    }
  }

  async findThreadByUsername(username) {
    try {
      console.log(`\n🔍 사용자 @${username}와의 대화 찾는 중...`);
      
      let userId = null;
      try {
        const user = await this.ig.user.searchExact(username);
        userId = user.pk;
        console.log(`[+] ${username} (ID: ${userId}) DM 검색 중...`);
      } catch (searchError) {
        console.log(`⚠️ 사용자 검색 실패. 사용자명으로 직접 찾기 시도...`);
        userId = null;
      }
      
      let threads = [];
      let retryCount = 0;
      const maxRetries = 5;
      
      while (retryCount <= maxRetries) {
        try {
          const inboxFeed = this.ig.feed.directInbox();
          threads = await inboxFeed.items();
          break;
        } catch (error) {
          if (error.message && error.message.includes('467')) {
            retryCount++;
            if (retryCount <= maxRetries) {
              const waitTime = retryCount * 30000;
              console.log(`⚠️ API 제한 오류 (467). ${waitTime/1000}초 대기 후 재시도... (${retryCount}/${maxRetries})`);
              await this.sleep(waitTime);
            } else {
              console.error('❌ API 제한 오류가 계속 발생합니다.');
              console.error('💡 해결 방법:');
              console.error('   1. 몇 분(5-10분) 기다린 후 다시 시도하세요.');
              console.error('   2. bot.js를 중지하고 extractDMs.js만 실행하세요.');
              console.error('   3. Instagram 앱에서 정상적으로 로그인하여 계정 상태를 확인하세요.');
              return null;
            }
          } else {
            console.error('❌ inbox 가져오기 실패:', error.message);
            return null;
          }
        }
      }
      
      if (!threads || threads.length === 0) {
        console.log('❌ DM 스레드를 찾을 수 없습니다.');
        return null;
      }
      
      let targetThread = null;
      
      if (userId) {
        targetThread = threads.find(t => t.users && t.users.some(u => u.pk === userId));
      }
      
      if (!targetThread) {
        for (const thread of threads) {
          if (thread.users && Array.isArray(thread.users)) {
            for (const user of thread.users) {
              if (user.username && user.username.toLowerCase() === username.toLowerCase()) {
                targetThread = thread;
                break;
              }
            }
            if (targetThread) break;
          }
        }
      }
      
      if (!targetThread) {
        console.log(`❌ @${username}와의 대화를 찾을 수 없습니다.`);
        return null;
      }
      
      console.log(`✅ 대화 스레드 찾음! (Thread ID: ${targetThread.thread_id || targetThread.thread_v2_id || targetThread.id})`);
      return targetThread;
    } catch (error) {
      console.error('❌ 스레드 찾기 실패:', error.message);
      if (error.message && error.message.includes('467')) {
        console.error('💡 API 제한 오류입니다. 잠시 후 다시 시도하세요.');
      }
      return null;
    }
  }

  async getAllMessages(threadId) {
    try {
      console.log(`\n📥 모든 메시지 가져오는 중...`);
      const allMessages = [];
      const threadFeed = this.ig.feed.directThread({ threadId: threadId.toString() });
      
      let hasMore = true;
      let pageCount = 0;
      
      while (hasMore) {
        let retryCount = 0;
        const maxRetries = 3;
        let messages = [];
        let pageSuccess = false;
        
        while (retryCount <= maxRetries && !pageSuccess) {
          try {
            messages = await threadFeed.items();
            pageSuccess = true;
          } catch (error) {
            retryCount++;
            
            console.error(`\n   ❌ 페이지 ${pageCount + 1} API 오류 상세 정보:`);
            console.error(`      메시지: ${error.message || '알 수 없음'}`);
            if (error.response) {
              console.error(`      상태 코드: ${error.response.status || '알 수 없음'}`);
              console.error(`      상태 텍스트: ${error.response.statusText || '알 수 없음'}`);
              if (error.response.body) {
                console.error(`      응답 본문: ${JSON.stringify(error.response.body).substring(0, 200)}`);
              }
            }
            if (error.statusCode) {
              console.error(`      상태 코드: ${error.statusCode}`);
            }
            if (error.text) {
              console.error(`      에러 텍스트: ${error.text.substring(0, 200)}`);
            }
            console.error(`      전체 에러: ${JSON.stringify(error, Object.getOwnPropertyNames(error)).substring(0, 500)}\n`);
            
            if (error.message && error.message.includes('467')) {
              const waitTime = retryCount * 3000;
              if (retryCount <= maxRetries) {
                console.log(`   ⚠️ API 제한 오류. ${waitTime/1000}초 후 재시도... (${retryCount}/${maxRetries})`);
                await this.sleep(waitTime);
              } else {
                console.error(`   ❌ 페이지 ${pageCount + 1} 가져오기 실패: API 제한 오류`);
                hasMore = false;
                break;
              }
            } else {
              console.error(`   ❌ 페이지 ${pageCount + 1} 가져오기 실패`);
              hasMore = false;
              break;
            }
          }
        }
        
        if (!pageSuccess) {
          break;
        }
        
        if (!messages || messages.length === 0) {
          hasMore = false;
          break;
        }
        
        const existingIds = new Set(allMessages.map(m => this.getMessageId(m)));
        const newMessages = messages.filter(m => {
          const msgId = this.getMessageId(m);
          return msgId && !existingIds.has(msgId);
        });
        
        if (newMessages.length === 0) {
          hasMore = false;
          break;
        }
        
        allMessages.push(...newMessages);
        pageCount++;
        console.log(`   페이지 ${pageCount}: ${newMessages.length}개 메시지 추가 (총 ${allMessages.length}개)`);
        
        if (!threadFeed.isMoreAvailable()) {
          hasMore = false;
          break;
        }
        
        await this.sleep(1000);
      }
      
      allMessages.sort((a, b) => {
        const timeA = this.getMessageTimestamp(a);
        const timeB = this.getMessageTimestamp(b);
        return timeA - timeB;
      });
      
      console.log(`\n✅ 총 ${allMessages.length}개의 메시지를 가져왔습니다.`);
      return allMessages;
    } catch (error) {
      console.error('❌ 메시지 가져오기 실패:', error.message);
      return [];
    }
  }

  getMessageId(msg) {
    if (!msg) return null;
    return msg.item_id || msg.id || msg.pk || msg.client_context || 
           (msg.item_id ? String(msg.item_id) : null) ||
           (msg.id ? String(msg.id) : null);
  }

  getMessageTimestamp(msg) {
    if (!msg) return 0;
    
    if (msg.timestamp) {
      const ts = parseInt(msg.timestamp);
      if (ts > 10000000000000) return Math.floor(ts / 1000);
      if (ts > 1000000000) return ts;
      return ts * 1000;
    }
    
    if (msg.timestamp_in_seconds) {
      return parseInt(msg.timestamp_in_seconds) * 1000;
    }
    
    if (msg.created_at) {
      return parseInt(msg.created_at) * 1000;
    }
    
    if (msg.taken_at) {
      return parseInt(msg.taken_at) * 1000;
    }
    
    if (msg.time) {
      const ts = parseInt(msg.time);
      if (ts > 10000000000000) return Math.floor(ts / 1000);
      if (ts > 1000000000) return ts;
      return ts * 1000;
    }
    
    return 0;
  }

  formatMessage(msg, currentUserId) {
    const timestamp = this.getMessageTimestamp(msg);
    const date = new Date(timestamp);
    const dateStr = date.toLocaleString('ko-KR', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
    
    const isFromMe = msg.user_id === currentUserId || 
                    msg.user_id?.toString() === currentUserId?.toString() ||
                    (msg.user && msg.user.pk === currentUserId) ||
                    (msg.user && msg.user.pk?.toString() === currentUserId?.toString());
    
    const sender = isFromMe ? '나' : (msg.user?.username || '알 수 없음');
    const text = msg.text || '';
    const itemType = msg.item_type || 'text';
    
    return {
      id: this.getMessageId(msg),
      timestamp: timestamp,
      date: dateStr,
      sender: sender,
      isFromMe: isFromMe,
      text: text,
      itemType: itemType,
      raw: msg
    };
  }

  async saveMessages(username, messages, currentUserId) {
    try {
      const safeUsername = username.replace(/[^a-zA-Z0-9._-]/g, '_');
      const userDir = path.join(__dirname, 'logs', safeUsername);
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      
      let textContent = `=== Instagram DM 내역 ===\n`;
      textContent += `사용자: @${username}\n`;
      textContent += `추출 일시: ${new Date().toLocaleString('ko-KR')}\n`;
      textContent += `총 메시지 수: ${messages.length}개\n`;
      textContent += `\n${'='.repeat(50)}\n\n`;
      
      messages.forEach((msg, index) => {
        const formatted = this.formatMessage(msg, currentUserId);
        textContent += `[${index + 1}] ${formatted.date}\n`;
        textContent += `${formatted.isFromMe ? '나' : `@${username}`}: ${formatted.text || '(메시지 없음)'}\n`;
        textContent += `\n`;
      });
      
      const txtFile = path.join(userDir, `${safeUsername}.txt`);
      fs.writeFileSync(txtFile, textContent, 'utf8');
      console.log(`\n💾 파일 저장: ${txtFile}`);
      
      return { txtFile };
    } catch (error) {
      console.error('❌ 파일 저장 실패:', error.message);
      throw error;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async extract(username) {
    try {
      console.log('\n🚀 Instagram DM 추출 시작\n');
      
      let loginSuccess = false;
      let retryCount = 0;
      const maxRetries = 2;
      
      while (!loginSuccess && retryCount <= maxRetries) {
        try {
          const currentUser = await this.login();
          const currentUserId = currentUser.pk;
          console.log(`\n✅ 로그인 완료: @${currentUser.username}\n`);
          loginSuccess = true;
          
          console.log('⏳ API 준비 중... (5초 대기)');
          await this.sleep(5000);
          
          const thread = await this.findThreadByUsername(username);
          if (!thread) {
            return;
          }
          
          const threadId = thread.thread_id || thread.thread_v2_id || thread.id || thread.pk;
          if (!threadId) {
            console.log('❌ 스레드 ID를 찾을 수 없습니다.');
            return;
          }
          
          const messages = await this.getAllMessages(threadId);
          if (messages.length === 0) {
            console.log('❌ 메시지가 없습니다.');
            return;
          }
          
          await this.saveMessages(username, messages, currentUserId);
          
          console.log('\n✅ DM 추출 완료!\n');
          return;
        } catch (error) {
          if (error instanceof IgCheckpointError || (error.message && error.message.includes('checkpoint'))) {
            retryCount++;
            if (retryCount <= maxRetries) {
              console.log(`\n⚠️ Checkpoint 오류 발생. 재시도합니다... (${retryCount}/${maxRetries})`);
              this.ig = new IgApiClient();
              await this.sleep(3000);
            } else {
              console.error('\n❌ Checkpoint 오류가 계속 발생합니다.');
              console.error('💡 해결 방법:');
              console.error('   1. Instagram 앱에서 로그인하여 보안 검증을 완료하세요.');
              console.error('   2. 몇 분 후 다시 시도하세요.');
              console.error('   3. Instagram 웹사이트에서 로그인하여 보안 검증을 완료하세요.');
              throw error;
            }
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      console.error('\n❌ 추출 실패:', error.message);
      if (error.message && error.message.includes('checkpoint')) {
        console.error('\n💡 Checkpoint 오류 해결 방법:');
        console.error('   1. Instagram 앱에서 로그인하여 보안 검증을 완료하세요.');
        console.error('   2. 몇 분 후 다시 시도하세요.');
      }
      process.exit(1);
    }
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n📱 Instagram DM 내역 추출 도구\n');
console.log('디엠내용을 뽑을 사람 ID를 입력하세요 (예: username 또는 user_id)\n');

rl.question('사용자 ID: ', async (username) => {
  rl.close();
  
  if (!username || username.trim().length === 0) {
    console.error('❌ 사용자 ID를 입력해주세요.');
    process.exit(1);
  }
  
  const extractor = new DMExtractor();
  await extractor.extract(username.trim());
  
  process.exit(0);
});

