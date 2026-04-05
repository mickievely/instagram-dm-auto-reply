const config = require('./config');
const fs = require('fs');
const path = require('path');
const { IgApiClient } = require('instagram-private-api');
const { IgLoginRequiredError, IgCheckpointError, IgResponseError } = require('instagram-private-api/dist/errors');
const https = require('https');

class InstagramAutoResponder {
  constructor() {
    this.ig = new IgApiClient();
    this.checkInterval = config.checkInterval || 10000;
    this.processedMessages = new Set();
    this.isRunning = false;
    this.botStartTime = null;
    
    this.userConversations = new Map();
    this.userProfiles = new Map();
    
    this.mentionResponse = config.mentionResponse || 'ㅇㅇ';
    this.mentionResponses = [
      'ㅇㅇ',
      '응',
      '왔어',
      '왔냐',
      'ㅎㅇ',
      '안녕',
      '뭐해',
      '왜',
      '어',
      '그래',
      'ㅇㅋ',
      '오케이',
      '좋아',
      '알겠어',
      'ㅇㅇㅇ'
    ];
    this.mentionTarget = config.mentionTarget || config.username || '';
    
    this.useAI = config.useAI || false;
    this.aiTriggerMode = config.aiTriggerMode || 'mention';
    
    if (config.geminiApiKeys && Array.isArray(config.geminiApiKeys) && config.geminiApiKeys.length > 0) {
      this.geminiApiKeys = config.geminiApiKeys;
      this.currentApiKeyIndex = 0;
      this.geminiApiKey = this.geminiApiKeys[this.currentApiKeyIndex];
    } else {
      this.geminiApiKey = config.geminiApiKey || '';
      this.geminiApiKeys = [this.geminiApiKey];
      this.currentApiKeyIndex = 0;
    }
    
    this.apiKeyBlockedUntil = new Map();
    
    this.apiKeyLastUsed = new Map();
    this.minRequestInterval = config.minRequestInterval || 3000;
    
    this.geminiModel = config.geminiModel || 'gemini-pro';
    this.aiSystemPrompt = config.aiSystemPrompt || '너는 딥러닝을 공부하고 있는 친구야. 항상 반말로 대화하고, 친구처럼 친근하고 편하게 말해.';
    
    this.sessionPath = path.join(__dirname, 'sessions');
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
    this.sessionFile = path.join(this.sessionPath, `${config.username || 'session'}.json`);
    
    
    this.isBlocked = false;
    this.blockedUntil = null;
    
    this.userAgents = [
      'Instagram 123.0.0.21.114 (iPhone11,8; iOS 13_3; en_US; en-US; scale=2.00; 828x1792) AppleWebKit/605.1.15',
      'Instagram 123.0.0.21.114 (iPhone12,1; iOS 14_0; en_US; en-US; scale=2.00; 1170x2532) AppleWebKit/605.1.15',
      'Instagram 123.0.0.21.114 (iPhone13,2; iOS 15_0; en_US; en-US; scale=3.00; 1284x2778) AppleWebKit/605.1.15',
      'Instagram 123.0.0.21.114 (SM-G973F; Android 11; en_US; en-US; scale=2.75; 1080x2400)',
      'Instagram 123.0.0.21.114 (Pixel 5; Android 12; en_US; en-US; scale=2.75; 1080x2340)',
    ];
    
    this.setupRequestInterceptor();
  }
  
  setupRequestInterceptor() {
    try {
      this.ig.request.end$.subscribe((req) => {
        if (req && req.headers) {
          const randomUA = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
          req.headers['user-agent'] = randomUA;
        }
      });
    } catch (error) {
    }
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

      const sessionLoaded = await this.loadSession();
      
      if (sessionLoaded) {
        try {
          const user = await this.ig.account.currentUser();
          console.log(`✅ 세션으로 로그인 성공: @${user.username}`);
          return user;
        } catch (error) {
          if (fs.existsSync(this.sessionFile)) {
            fs.unlinkSync(this.sessionFile);
          }
        }
      }

      this.ig.state.generateDevice(username);
      
      try {
        await this.ig.simulate.preLoginFlow();
      } catch (error) {
      }
      
      await this.sleep(Math.random() * 2000 + 1000);
      
      const user = await this.ig.account.login(username, password);
      
      try {
        process.nextTick(async () => {
          try {
            await this.ig.simulate.postLoginFlow();
          } catch (error) {
          }
        });
      } catch (error) {
      }
      
      await this.sleep(Math.random() * 2000 + 1000);
      
      await this.saveSession();
      
      return user;
    } catch (error) {
      if (error instanceof IgLoginRequiredError) {
        console.error('❌ 로그인 실패: 인증이 필요합니다. 2단계 인증이 활성화되어 있나요?');
        if (fs.existsSync(this.sessionFile)) {
          fs.unlinkSync(this.sessionFile);
        }
      } else if (error instanceof IgCheckpointError) {
        console.error('❌ 로그인 실패: Instagram이 보안 검증을 요청했습니다.');
      } else {
        console.error('❌ 로그인 실패:', error.message);
      }
      throw error;
    }
  }

  async checkInbox() {
    try {
      const inboxFeed = this.ig.feed.directInbox();
      const threads = await inboxFeed.items();
      return threads || [];
    } catch (error) {
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

  filterNewMessages(messages) {
    if (!messages || messages.length === 0) {
      return [];
    }

    const filtered = messages.filter(msg => {
      if (!msg) return false;
      
      const messageId = this.getMessageId(msg);
      if (!messageId) return false;
      
      if (this.processedMessages.has(messageId)) {
        return false;
      }
      
      const currentUserId = this.ig.state.cookieUserId;
      const isFromMe = msg.user_id === currentUserId || 
                      msg.user_id?.toString() === currentUserId?.toString() ||
                      (msg.user && msg.user.pk === currentUserId) ||
                      (msg.user && msg.user.pk?.toString() === currentUserId?.toString());
      
      if (isFromMe) {
        this.processedMessages.add(messageId);
        return false;
      }
      
      if (!this.botStartTime) {
        this.processedMessages.add(messageId);
        return false;
      }
      
      const messageTimestamp = this.getMessageTimestamp(msg);
      
      if (messageTimestamp === 0) {
        this.processedMessages.add(messageId);
        return false;
      }
      
      if (messageTimestamp < this.botStartTime) {
        this.processedMessages.add(messageId);
        return false;
      }
      
      const isTextMessage = msg.item_type === 'text' || 
                           msg.item_type === 'media_share' ||
                           msg.text !== undefined ||
                           (msg.text && msg.text.length > 0);
      
      if (!isTextMessage) {
        this.processedMessages.add(messageId);
        return false;
      }
      
      return true;
    });

    return filtered;
  }

  async getNewMessages(thread, providedThreadId = null) {
    try {
      let messages = [];
      
      if (thread.items && Array.isArray(thread.items) && thread.items.length > 0) {
        messages = thread.items;
      } else if (thread.last_permanent_item) {
        messages = [thread.last_permanent_item];
      } else {
        let threadId = providedThreadId || thread.thread_id || thread.thread_v2_id || thread.id || thread.pk;
        
        if (!threadId) {
          return [];
        }
        
        threadId = String(threadId).trim();
        
        if (!threadId || threadId === 'undefined' || threadId === 'null' || threadId.length === 0) {
          return [];
        }
        
        const threadFeed = this.ig.feed.directThread({ threadId: threadId.toString() });
        messages = await threadFeed.items();
      }
      
      if (!messages || messages.length === 0) {
        return [];
      }
      
      return this.filterNewMessages(messages);
    } catch (error) {
      return [];
    }
  }

  isMentioned(messageText) {
    if (!messageText) return false;
    const mentionPattern = new RegExp(`${this.mentionTarget}`, 'i');
    return mentionPattern.test(messageText);
  }
  
  async generateAIResponse(messageText, username = null) {
    if (!this.useAI) {
      return this.mentionResponse;
    }

    try {
      return await this.generateGeminiResponse(messageText, username);
    } catch (error) {
      return this.mentionResponse;
    }
  }

  saveConversationHistory(username, userMessage, botResponse) {
    if (!username || username === '알 수 없음') return;
    
    if (!this.userConversations.has(username)) {
      this.userConversations.set(username, []);
    }
    
    const history = this.userConversations.get(username);
    history.push({
      userMessage: userMessage,
      botResponse: botResponse,
      timestamp: Date.now()
    });
    
    if (history.length > 20) {
      history.shift();
    }
    
    this.analyzeUserStyle(username, userMessage);
  }

  analyzeUserStyle(username, message) {
    if (!this.userProfiles.has(username)) {
      this.userProfiles.set(username, { interests: [], moods: [] });
    }
    
    const profile = this.userProfiles.get(username);
    const messageLower = message.toLowerCase();
    const history = this.userConversations.get(username) || [];
    
    if (!profile.style) {
      if (messageLower.includes('ㅋ') || messageLower.includes('ㅎ') || messageLower.includes('하하') || messageLower.includes('웃')) {
        profile.style = '유머러스하고 장난스러운';
      } else if (messageLower.includes('?') || messageLower.includes('뭐') || messageLower.includes('어떻게') || messageLower.includes('왜')) {
        profile.style = '궁금해하고 질문이 많은';
      } else if (message.length < 10) {
        profile.style = '짧고 간결한';
      } else if (messageLower.includes('고마') || messageLower.includes('감사')) {
        profile.style = '예의바르고 친절한';
      } else {
        profile.style = '자연스럽고 편안한';
      }
    }
    
    const interests = ['딥러닝', 'AI', '프로그래밍', '코딩', '게임', '음악', '영화', '드라마', '운동', '여행', '음식', '공부', '학교', '일', '취미'];
    interests.forEach(interest => {
      if (messageLower.includes(interest.toLowerCase()) && !profile.interests.includes(interest)) {
        profile.interests.push(interest);
        if (profile.interests.length > 5) {
          profile.interests.shift();
        }
      }
    });
    
    if (messageLower.includes('힘들') || messageLower.includes('피곤') || messageLower.includes('스트레스')) {
      profile.mood = '피곤하거나 힘든 상태';
    } else if (messageLower.includes('좋') || messageLower.includes('행복') || messageLower.includes('기쁘')) {
      profile.mood = '기분 좋은 상태';
    } else if (messageLower.includes('슬프') || messageLower.includes('우울') || messageLower.includes('힘들어')) {
      profile.mood = '슬프거나 힘든 상태';
    } else if (history.length > 0) {
      const lastMood = profile.mood;
      if (!lastMood) {
        profile.mood = '평범한 상태';
      }
    }
  }

  analyzeConversationTopics(history) {
    const topics = [];
    const keywords = {
      '딥러닝': ['딥러닝', '머신러닝', 'AI', '인공지능', '모델', '학습', '신경망'],
      '일상': ['뭐해', '어디', '지금', '오늘', '내일'],
      '공부': ['공부', '시험', '과제', '학교', '수업'],
      '게임': ['게임', '플레이', '승리', '패배'],
      '음식': ['먹', '식사', '맛있', '배고']
    };
    
    history.forEach(h => {
      const text = (h.userMessage + ' ' + h.botResponse).toLowerCase();
      Object.keys(keywords).forEach(topic => {
        if (keywords[topic].some(keyword => text.includes(keyword))) {
          if (!topics.includes(topic)) {
            topics.push(topic);
          }
        }
      });
    });
    
    return topics.slice(-3);
  }

  switchToNextApiKey() {
    let attempts = 0;
    
    while (attempts < this.geminiApiKeys.length) {
      this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.geminiApiKeys.length;
      attempts++;
      
      const blockedUntil = this.apiKeyBlockedUntil.get(this.currentApiKeyIndex);
      if (!blockedUntil || Date.now() >= blockedUntil) {
        this.geminiApiKey = this.geminiApiKeys[this.currentApiKeyIndex];
        if (blockedUntil) {
          this.apiKeyBlockedUntil.delete(this.currentApiKeyIndex);
        }
        return this.currentApiKeyIndex;
      }
    }
    
    return -1;
  }

  async generateGeminiResponse(messageText, username = null) {
    if (!this.geminiApiKey) {
      console.error('❌ Gemini API 키가 설정되지 않았습니다.');
      return this.mentionResponse;
    }
    
    const blockedUntil = this.apiKeyBlockedUntil.get(this.currentApiKeyIndex);
    if (blockedUntil && Date.now() < blockedUntil) {
      if (this.geminiApiKeys.length > 1) {
        const nextKeyIndex = this.switchToNextApiKey();
        if (nextKeyIndex === -1) {
          return this.mentionResponse;
        }
      } else {
        return this.mentionResponse;
      }
    }
    
    const lastUsed = this.apiKeyLastUsed.get(this.currentApiKeyIndex);
    if (lastUsed) {
      const timeSinceLastUse = Date.now() - lastUsed;
      if (timeSinceLastUse < this.minRequestInterval) {
        const waitTime = this.minRequestInterval - timeSinceLastUse;
        if (this.geminiApiKeys.length > 1) {
          const nextKeyIndex = this.switchToNextApiKey();
          if (nextKeyIndex !== -1 && nextKeyIndex !== this.currentApiKeyIndex) {
          } else {
            await this.sleep(waitTime);
          }
        } else {
          await this.sleep(waitTime);
        }
      }
    }
    
    this.apiKeyLastUsed.set(this.currentApiKeyIndex, Date.now());

    try {
      const cleanString = (str) => {
        if (!str) return '';
        return String(str)
          .replace(/\0/g, '')
          .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
          .trim();
      };
      
      const safeSystemPrompt = cleanString(this.aiSystemPrompt || '');
      const safeMessageText = cleanString(messageText || '');
      
      let prompt = safeSystemPrompt;
      prompt += `\n${safeMessageText}`;
      
      let data;
      try {
        data = JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topP: 0.8,
            topK: 20
          }
        });
      } catch (jsonError) {
        console.error('❌ JSON 생성 실패:', jsonError.message);
        return this.mentionResponse;
      }

      let apiVersion = 'v1beta';
      if (this.geminiModel.includes('gemini-1.5') || this.geminiModel.includes('gemini-2.5')) {
        apiVersion = 'v1beta';
      } else if (this.geminiModel === 'gemini-pro') {
        apiVersion = 'v1beta';
      }
      
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/${apiVersion}/models/${this.geminiModel}:generateContent?key=${this.geminiApiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data, 'utf8')
        }
      };

      return new Promise((resolve) => {
        const req = https.request(options, (res) => {
          let responseData = '';

          res.on('data', (chunk) => {
            responseData += chunk;
          });

          res.on('end', () => {
            try {
              const json = JSON.parse(responseData);
              
              if (json.error) {
                const errorMessage = json.error.message || JSON.stringify(json.error);
                
                if (errorMessage.includes('quota') || errorMessage.includes('Quota exceeded')) {
                  const retryMatch = errorMessage.match(/Please retry in ([\d.]+)s/);
                  let retrySeconds = retryMatch ? parseFloat(retryMatch[1]) : 60;
                  
                  const blockedKeyIndex = this.currentApiKeyIndex;
                  this.apiKeyBlockedUntil.set(blockedKeyIndex, Date.now() + (retrySeconds * 1000));
                  
                  if (this.geminiApiKeys.length > 1) {
                    const nextKeyIndex = this.switchToNextApiKey();
                    if (nextKeyIndex !== -1 && nextKeyIndex !== blockedKeyIndex) {
                      return this.generateGeminiResponse(messageText, username);
                    }
                    
                    this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.geminiApiKeys.length;
                    this.geminiApiKey = this.geminiApiKeys[this.currentApiKeyIndex];
                  }
                }
                resolve(this.mentionResponse);
                return;
              }
              
              if (json.candidates && json.candidates[0]) {
                const candidate = json.candidates[0];
                const finishReason = candidate.finishReason;
                
                if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                  const text = candidate.content.parts[0].text;
                  if (text && text.trim().length > 0) {
                    let trimmedText = text.trim();
                    
                    const originalText = trimmedText;
                    
                    trimmedText = trimmedText.replace(/^(너|나|응답|친구|이전)\s*:\s*/i, '');
                    
                    if (trimmedText.includes('→')) {
                      const parts = trimmedText.split('→');
                      if (parts.length > 1) {
                        trimmedText = parts[parts.length - 1].trim();
                      }
                    }
                    
                    if (trimmedText.includes(' / ')) {
                      trimmedText = trimmedText.split(' / ')[0].trim();
                    }
                    
                    if (trimmedText.includes('\n')) {
                      const lines = trimmedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                      if (lines.length > 0) {
                        const firstLine = lines[0];
                        if (firstLine.length >= 3) {
                          trimmedText = firstLine;
                        } else {
                          trimmedText = lines.join(' ').trim();
                        }
                      }
                    }
                    
                    trimmedText = trimmedText.trim();
                    
                    if (trimmedText.length < 2) {
                      console.log(`[ DEBG ] 응답 후처리 후 너무 짧음 (${trimmedText.length}자) - 원본 복원`);
                      trimmedText = originalText.trim();
                    }
                    
                    if (trimmedText.length < 2) {
                      trimmedText = text.trim();
                    }
                    
                    if (finishReason === 'MAX_TOKENS') {
                      console.log(`[ DEBG ] 응답 토큰 제한 (부분 응답 사용): "${trimmedText.substring(0, 30)}"`);
                    }
                    
                    console.log(`[ DEBG ] 최종 AI 응답: "${trimmedText.substring(0, 50)}"`);
                    
                    if (this.geminiApiKeys.length > 1) {
                      this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.geminiApiKeys.length;
                      this.geminiApiKey = this.geminiApiKeys[this.currentApiKeyIndex];
                    }
                    
                    resolve(trimmedText);
                    return;
                  }
                }
                
                console.log(`[ DEBG ] Gemini 응답 비어있음 (finishReason: ${finishReason}) - 기본 응답 사용`);
                
                if (this.geminiApiKeys.length > 1) {
                  this.currentApiKeyIndex = (this.currentApiKeyIndex + 1) % this.geminiApiKeys.length;
                  this.geminiApiKey = this.geminiApiKeys[this.currentApiKeyIndex];
                }
                
                resolve(this.mentionResponse);
              } else {
                console.error('❌ Gemini 응답 형식이 올바르지 않습니다:', JSON.stringify(json).substring(0, 200));
                resolve(this.mentionResponse);
              }
            } catch (error) {
              console.error('❌ Gemini 응답 파싱 실패:', error.message);
              resolve(this.mentionResponse);
            }
          });
        });

        req.on('error', (error) => {
          console.error('❌ Gemini API 요청 실패:', error.message);
          resolve(this.mentionResponse);
        });

        req.write(data);
        req.end();
      });
    } catch (error) {
      return this.mentionResponse;
    }
  }

  async indicateTyping(threadId, isTyping = true) {
    try {
      if (!threadId) return;
      
      threadId = String(threadId);
      const threadEntity = this.ig.entity.directThread(threadId);
      
      if (threadEntity.indicateActivity) {
        if (isTyping) {
          await threadEntity.indicateActivity(true);
        } else {
          await threadEntity.indicateActivity(false);
        }
      }
    } catch (error) {
    }
  }

  async sendAutoResponse(thread, message, responseText) {
    try {
      if (!responseText) {
        console.error('❌ 응답 텍스트가 비어있습니다.');
        return { success: false, response: null };
      }
      
      let threadId = thread.thread_id || thread.thread_v2_id || thread.id || thread.pk;
      
      if (!threadId) {
        console.error('❌ Thread ID를 찾을 수 없습니다.');
        return { success: false, response: null };
      }
      
      threadId = String(threadId);
      
      const threadEntity = this.ig.entity.directThread(threadId);
      
      let sendSuccess = false;
      let retryCount = 0;
      const maxRetries = 2;
      
      while (!sendSuccess && retryCount <= maxRetries) {
        try {
          if (retryCount > 0) {
            console.log(`      [전송 상세] 재시도 ${retryCount}/${maxRetries}...`);
            await this.sleep(1000 * retryCount);
          }
          
          const broadcastResult = await threadEntity.broadcastText(responseText);
          
          await this.sleep(800);
          
          try {
            if (broadcastResult && broadcastResult.item_id) {
              sendSuccess = true;
            } else {
              const validThreadId = String(threadId).trim();
              if (validThreadId && validThreadId !== 'undefined' && validThreadId !== 'null' && validThreadId !== '') {
                const threadFeed = this.ig.feed.directThread({ threadId: validThreadId });
                const recentMessages = await threadFeed.items();
                
                if (recentMessages && recentMessages.length > 0) {
                  const latestMessage = recentMessages[0];
                  const latestText = latestMessage.text || '';
                  const currentUserId = this.ig.state.cookieUserId;
                  const isFromMe = latestMessage.user_id === currentUserId || 
                                  latestMessage.user_id?.toString() === currentUserId?.toString() ||
                                  (latestMessage.user && latestMessage.user.pk === currentUserId);
                  
                  if (isFromMe && latestText.trim() === responseText.trim()) {
                    sendSuccess = true;
                    break;
                  }
                }
              }
              
              if (broadcastResult && broadcastResult.item_id) {
                sendSuccess = true;
              }
            }
          } catch (verifyError) {
            if (broadcastResult && broadcastResult.item_id) {
              sendSuccess = true;
            }
          }
          
          if (!sendSuccess && broadcastResult && broadcastResult.item_id) {
            sendSuccess = true;
          }
          
        } catch (broadcastError) {
          retryCount++;
          if (retryCount > maxRetries) {
            throw broadcastError;
          }
        }
      }
      
      if (!sendSuccess) {
        throw new Error('메시지 전송 확인 실패');
      }
      
      this.indicateTyping(threadId, false).catch(() => {});
      
      await this.sleep(300);
      
      return { success: true, response: responseText };
    } catch (error) {
      const threadId = thread.thread_id || thread.thread_v2_id || thread.id || thread.pk;
      if (threadId) {
        await this.indicateTyping(threadId, false);
      }
      return { success: false, response: null };
    }
  }

  async start() {
    try {
      await this.login();
      this.isRunning = true;
      this.botStartTime = Date.now();
      
      await this.sleep(1000);
      
      setInterval(async () => {
        if (this.isRunning) {
          await this.processMessages();
        }
      }, this.checkInterval);
      
    } catch (error) {
      console.error('❌ 봇 시작 실패:', error.message);
      process.exit(1);
    }
  }

  async processMessages() {
    try {
      if (this.isBlocked) {
        if (this.blockedUntil && Date.now() < this.blockedUntil) {
          return;
        } else {
          this.isBlocked = false;
          this.blockedUntil = null;
        }
      }
      
      const threads = await this.checkInbox();
      
      if (!threads || threads.length === 0) {
        return;
      }
      
      for (const thread of threads) {
        if (!thread) continue;
        
        const threadId = thread.thread_id || thread.thread_v2_id || thread.id || thread.pk;
        if (!threadId) {
          continue;
        }
        
        let newMessages = [];
        try {
          newMessages = await this.getNewMessages(thread, String(threadId));
        } catch (error) {
          newMessages = [];
        }
        
        for (const message of newMessages) {
          if (!message) continue;
          
          const messageId = this.getMessageId(message);
          if (!messageId) {
            continue;
          }
          
          if (this.processedMessages.has(messageId)) {
            continue;
          }
          
          this.processedMessages.add(messageId);
          
          const messageText = message.text || '';
          let senderName = '알 수 없음';
          if (message.user) {
            senderName = message.user.username || message.user.full_name || '알 수 없음';
          } else if (thread.users && thread.users.length > 0) {
            senderName = thread.users[0].username || thread.users[0].full_name || '알 수 없음';
          }
          
          const isMention = this.isMentioned(messageText);
          const threadId = thread.thread_id || thread.thread_v2_id || thread.id || thread.pk;
          
          let responseText = null;
          let typingInterval = null;
          
          try {
            if (isMention) {
              const randomIndex = Math.floor(Math.random() * this.mentionResponses.length);
              responseText = this.mentionResponses[randomIndex];
            } else {
              if (this.useAI) {
                if (threadId) {
                  this.indicateTyping(threadId, true).catch(() => {});
                }
                
                typingInterval = setInterval(async () => {
                  if (threadId) {
                    this.indicateTyping(threadId, true).catch(() => {});
                  }
                }, 2000);
                
                responseText = await this.generateAIResponse(messageText, senderName);
                
                if (typingInterval) {
                  clearInterval(typingInterval);
                  typingInterval = null;
                }
                
                if (!responseText || responseText.trim().length === 0) {
                  console.log(`[ DEBG ] AI 응답 비어있음 - 랜덤 응답 사용`);
                  const randomIndex = Math.floor(Math.random() * this.mentionResponses.length);
                  responseText = this.mentionResponses[randomIndex];
                } else if (responseText === this.mentionResponse) {
                  console.log(`[ DEBG ] AI가 기본 응답 반환 (할당량 초과 가능) - 랜덤 응답 사용`);
                  const randomIndex = Math.floor(Math.random() * this.mentionResponses.length);
                  responseText = this.mentionResponses[randomIndex];
                }
              } else {
                const randomIndex = Math.floor(Math.random() * this.mentionResponses.length);
                responseText = this.mentionResponses[randomIndex];
              }
            }
          } catch (error) {
            if (typingInterval) {
              clearInterval(typingInterval);
              typingInterval = null;
            }
            const randomIndex = Math.floor(Math.random() * this.mentionResponses.length);
            responseText = this.mentionResponses[randomIndex];
          } finally {
            if (threadId && typingInterval) {
              clearInterval(typingInterval);
            }
            if (threadId && !isMention) {
              this.indicateTyping(threadId, false).catch(() => {});
            }
          }
          
          if (responseText && responseText.trim().length > 0) {
            try {
              const result = await this.sendAutoResponse(thread, message, responseText);
              
              if (result.success) {
                console.log(`[ DEBG ] ${senderName} | ${messageText} | ${result.response}`);
                
                if (!isMention && this.useAI && result.response && result.response !== this.mentionResponse) {
                  this.saveConversationHistory(senderName, messageText, result.response);
                }
              } else {
                console.log(`[ DEBG ] ${senderName} | ${messageText} | (전송 실패)`);
              }
              
              await this.sleep(200);
            } catch (sendError) {
              console.log(`[ DEBG ] ${senderName} | ${messageText} | (전송 에러)`);
            }
          } else {
            try {
              const result = await this.sendAutoResponse(thread, message, this.mentionResponse);
              console.log(`[ DEBG ] ${senderName} | ${messageText} | ${result.success ? this.mentionResponse : '(전송 실패)'}`);
            } catch (error) {
              console.log(`[ DEBG ] ${senderName} | ${messageText} | (전송 예외)`);
            }
          }
        }
      }
    } catch (error) {
      await this.sleep(60000);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async stop() {
    this.isRunning = false;
    await this.saveSession();
  }
}

const bot = new InstagramAutoResponder();

process.on('SIGINT', async () => {
  await bot.stop();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ 처리되지 않은 오류:', error);
});

bot.start().catch(error => {
  console.error('❌ 치명적 오류:', error);
  process.exit(1);
});

