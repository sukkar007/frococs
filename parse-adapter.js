// ============================================
// FruitWheel Parse Adapter - النسخة المحسنة
// ============================================

(function() {
    console.log('🎮 [FruitWheel Adapter] بدء التهيئة...');
    
    // تسجيل البداية
    window.FruitWheelAdapterStatus = {
        initialized: false,
        timestamp: new Date().toISOString(),
        errors: [],
        logs: []
    };

    const urlParams = new URLSearchParams(window.location.search);
    const sessionToken = urlParams.get('sessionToken');
    const appId = urlParams.get('appId');
    const serverURL = urlParams.get('serverURL') || 'https://parseapi.back4app.com';

    console.log('🔧 [FruitWheel Adapter] معاملات:', {
        sessionToken: sessionToken ? 'موجود' : 'غير موجود',
        appId: appId ? 'موجود' : 'غير موجود',
        serverURL: serverURL
    });

    // تهيئة Parse مع معالجة الأخطاء الشاملة
    if (window.Parse) {
        try {
            if (appId) {
                Parse.initialize(appId);
                Parse.serverURL = serverURL;
                console.log('✅ [FruitWheel Adapter] تم تهيئة Parse بنجاح');
                window.FruitWheelAdapterStatus.parseInitialized = true;
            } else {
                console.warn('⚠️ [FruitWheel Adapter] لم يتم توفير appId');
            }
            
            if (sessionToken) {
                Parse.User.become(sessionToken).then(() => {
                    console.log('✅ [FruitWheel Adapter] تم تسجيل الدخول بنجاح');
                }).catch(e => {
                    console.error('❌ [FruitWheel Adapter] خطأ في المصادقة:', e);
                    window.FruitWheelAdapterStatus.errors.push('Auth Error: ' + e.message);
                });
            }
        } catch (e) {
            console.error('❌ [FruitWheel Adapter] خطأ في تهيئة Parse:', e);
            window.FruitWheelAdapterStatus.errors.push('Parse Init Error: ' + e.message);
        }
    } else {
        console.warn('⚠️ [FruitWheel Adapter] Parse غير متاح');
        window.FruitWheelAdapterStatus.errors.push('Parse not available');
    }

    const OriginalWebSocket = window.WebSocket;
    
    function FruitWebSocket(url) {
        console.log('🌐 [FruitWebSocket] إنشاء اتصال جديد:', url);
        
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        this._pb = null;
        this._currentRoundId = null;
        this._syncInterval = null;
        this._retryCount = 0;
        this._maxRetries = 5;
        this.url = url;

        // تسجيل في الحالة العامة
        window.FruitWheelAdapterStatus.websocketCreated = true;
        window.FruitWheelAdapterStatus.websocketUrl = url;

        // زيادة التأخير للهواتف البطيئة
        setTimeout(() => this._init(), 500);
    }

    FruitWebSocket.prototype._init = function() {
        console.log('📡 [FruitWebSocket] تهيئة الاتصال');
        this.readyState = 1;
        
        if (this.onopen) {
            try {
                this.onopen({ type: 'open' });
                console.log('✅ [FruitWebSocket] تم استدعاء onopen');
            } catch (e) {
                console.error('❌ [FruitWebSocket] خطأ في onopen:', e);
                window.FruitWheelAdapterStatus.errors.push('onopen Error: ' + e.message);
            }
        }
        
        const checkPb = () => {
            try {
                const protoMod = System.get('chunks:///_virtual/proto.js');
                if (protoMod && protoMod.default && protoMod.default.pb) {
                    this._pb = protoMod.default.pb;
                    console.log('✅ [FruitWebSocket] تم تحميل Protobuf بنجاح');
                    window.FruitWheelAdapterStatus.protobufLoaded = true;
                    this._startSync();
                } else {
                    if (this._retryCount < this._maxRetries) {
                        this._retryCount++;
                        console.log(`⏳ [FruitWebSocket] محاولة تحميل Protobuf (${this._retryCount}/${this._maxRetries})`);
                        setTimeout(checkPb, 1000);
                    } else {
                        console.error('❌ [FruitWebSocket] فشل تحميل Protobuf بعد عدة محاولات');
                        window.FruitWheelAdapterStatus.errors.push('Protobuf loading failed');
                        if (this.onerror) {
                            this.onerror({ type: 'error', message: 'فشل تحميل Protobuf' });
                        }
                    }
                }
            } catch (e) {
                console.error('❌ [FruitWebSocket] خطأ في فحص Protobuf:', e);
                window.FruitWheelAdapterStatus.errors.push('Protobuf check error: ' + e.message);
                if (this._retryCount < this._maxRetries) {
                    this._retryCount++;
                    setTimeout(checkPb, 1000);
                }
            }
        };
        checkPb();
    };

    FruitWebSocket.prototype._startSync = function() {
        console.log('🔄 [FruitWebSocket] بدء المزامنة مع الخادم');
        
        const sync = async () => {
            if (this.readyState !== 1) return;
            try {
                // التحقق من توفر Parse قبل الاستدعاء
                if (!window.Parse || !Parse.Cloud) {
                    console.warn('⚠️ [FruitWebSocket] Parse غير متاح، سيتم إعادة المحاولة...');
                    return;
                }

                console.log('📤 [FruitWebSocket] استدعاء fruit_game_info...');
                const res = await Parse.Cloud.run('fruit_game_info');
                
                if (res && res.code === 0) {
                    console.log('✅ [FruitWebSocket] استقبال بيانات اللعبة بنجاح');
                    this._handleData(res.data);
                    this._retryCount = 0; // إعادة تعيين عدد المحاولات عند النجاح
                } else {
                    console.warn('⚠️ [FruitWebSocket] استجابة غير صحيحة:', res);
                    window.FruitWheelAdapterStatus.errors.push('Invalid response: ' + JSON.stringify(res));
                }
            } catch (e) {
                console.error('❌ [FruitWebSocket] خطأ في المزامنة:', e);
                window.FruitWheelAdapterStatus.errors.push('Sync error: ' + e.message);
            }
            
            // إعادة المحاولة بعد 2 ثانية
            if (this.readyState === 1) {
                this._syncInterval = setTimeout(sync, 2000);
            }
        };
        sync();
    };

    FruitWebSocket.prototype._handleData = function(data) {
        if (!this._pb) {
            console.warn('⚠️ [FruitWebSocket] Protobuf غير جاهز بعد');
            return;
        }
        
        try {
            const pb = this._pb;
            console.log('📨 [FruitWebSocket] معالجة بيانات اللعبة');

            // 1. إرسال حالة اللعبة والوقت
            this._sendToGame('pb.FruitwheelGameInfoS2C', pb.FruitwheelGameInfoS2C.create({
                stage: data.stage || 0,
                roundId: data.roundId || '',
                leftSeconds: data.leftSeconds || 0,
                userCoin: data.userCoin || 0,
                historyFruit: data.history || [],
                myselfBet: data.myselfBet || [],
                totalBet: data.totalBet || []
            }));

            // 2. إذا تغيرت المرحلة إلى FINISH، نرسل النتيجة
            if (data.stage === 3 && this._currentRoundId !== data.roundId) {
                this._currentRoundId = data.roundId;
                console.log('🎉 [FruitWebSocket] إرسال نتيجة اللعبة');
                this._sendToGame('pb.FruitwheelGameResultS2A', pb.FruitwheelGameResultS2A.create({
                    roundId: data.roundId,
                    winId: (data.history && data.history[0]) || 0,
                    players: data.players || []
                }));
            }
        } catch (e) {
            console.error('❌ [FruitWebSocket] خطأ في معالجة البيانات:', e);
            window.FruitWheelAdapterStatus.errors.push('Data handling error: ' + e.message);
        }
    };

    FruitWebSocket.prototype.send = async function(buffer) {
        if (!this._pb) {
            console.warn('⚠️ [FruitWebSocket] Protobuf غير جاهز للإرسال');
            return;
        }
        
        try {
            const msg = this._unpack(buffer);
            if (msg && msg.name.includes('GameBetC2S')) {
                console.log('💰 [FruitWebSocket] استقبال رهان:', msg.name);
                const betData = this._pb.FruitwheelGameBetC2S.decode(msg.data);
                
                if (!window.Parse || !Parse.Cloud) {
                    console.warn('⚠️ [FruitWebSocket] Parse غير متاح للرهان');
                    return;
                }

                const res = await Parse.Cloud.run('fruit_game_bet', {
                    fruitId: betData.id,
                    amount: betData.bet
                });
                
                if (res && res.code === 0) {
                    console.log('✅ [FruitWebSocket] تم معالجة الرهان بنجاح');
                    this._sendToGame('pb.FruitwheelGameBetS2C', this._pb.FruitwheelGameBetS2C.create({
                        code: 0,
                        roundId: res.roundId,
                        id: res.fruitId,
                        bet: res.amount,
                        coin: res.newBalance
                    }));
                }
            }
        } catch (e) {
            console.error('❌ [FruitWebSocket] خطأ في الرهان:', e);
            window.FruitWheelAdapterStatus.errors.push('Bet error: ' + e.message);
        }
    };

    FruitWebSocket.prototype._unpack = function(buffer) {
        try {
            const uint8 = new Uint8Array(buffer);
            const nameLen = (uint8[0] << 8) | uint8[1];
            let name = '';
            for (let i = 0; i < nameLen; i++) {
                name += String.fromCharCode(uint8[2 + i]);
            }
            return { name: name, data: uint8.slice(2 + nameLen) };
        } catch (e) {
            console.error('❌ [FruitWebSocket] خطأ في فك تشفير الرسالة:', e);
            window.FruitWheelAdapterStatus.errors.push('Unpack error: ' + e.message);
            return null;
        }
    };

    FruitWebSocket.prototype._sendToGame = function(name, message) {
        try {
            const nameBytes = new TextEncoder().encode(name);
            const encoded = message.constructor.encode(message).finish();
            const packet = new Uint8Array(2 + nameBytes.length + encoded.length);
            packet[0] = (nameBytes.length >> 8) & 0xFF;
            packet[1] = nameBytes.length & 0xFF;
            packet.set(nameBytes, 2);
            packet.set(encoded, 2 + nameBytes.length);
            
            if (this.onmessage) {
                this.onmessage({ data: packet.buffer });
            }
        } catch (e) {
            console.error('❌ [FruitWebSocket] خطأ في إرسال الرسالة إلى اللعبة:', e);
            window.FruitWheelAdapterStatus.errors.push('Send error: ' + e.message);
        }
    };

    FruitWebSocket.prototype.close = function() {
        console.log('🔌 [FruitWebSocket] إغلاق الاتصال');
        this.readyState = 3;
        if (this._syncInterval) {
            clearTimeout(this._syncInterval);
        }
        if (this.onclose) {
            this.onclose({ code: 1000, reason: 'مغلق' });
        }
    };

    // استبدال WebSocket
    window.WebSocket = function(url) {
        if (url && url.includes('/fruitwheel')) {
            console.log('🎮 [WebSocket Override] استخدام FruitWebSocket لـ:', url);
            return new FruitWebSocket(url);
        }
        return new OriginalWebSocket(url);
    };

    // نسخ الثوابت
    window.WebSocket.CONNECTING = 0;
    window.WebSocket.OPEN = 1;
    window.WebSocket.CLOSING = 2;
    window.WebSocket.CLOSED = 3;

    // تصدير الدوال والفئات للاختبار
    window.FruitWebSocket = FruitWebSocket;
    window.OriginalWebSocket = OriginalWebSocket;

    // تسجيل النهاية
    window.FruitWheelAdapterStatus.initialized = true;
    window.FruitWheelAdapterStatus.completedAt = new Date().toISOString();

    console.log('✅ [FruitWheel Adapter] تم التهيئة بنجاح');
    console.log('📊 [FruitWheel Adapter] الحالة:', window.FruitWheelAdapterStatus);
})();
