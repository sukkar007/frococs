(function() {
    console.log('FruitWheel Adapter: Initializing...');

    const urlParams = new URLSearchParams(window.location.search);
    const sessionToken = urlParams.get('sessionToken');
    const appId = urlParams.get('appId');
    const serverURL = urlParams.get('serverURL') || 'https://parseapi.back4app.com';

    if (window.Parse) {
        Parse.initialize(appId);
        Parse.serverURL = serverURL;
        if (sessionToken) {
            Parse.User.become(sessionToken).catch(e => console.error('Auth Error', e));
        }
    }

    const OriginalWebSocket = window.WebSocket;
    
    function FruitWebSocket(url) {
        this.readyState = 0;
        this.onopen = null;
        this.onmessage = null;
        this._pb = null;
        this._currentRoundId = null;

        setTimeout(() => this._init(), 100);
    }

    FruitWebSocket.prototype._init = function() {
        this.readyState = 1;
        if (this.onopen) this.onopen();
        
        const checkPb = () => {
            const protoMod = System.get('chunks:///_virtual/proto.js');
            if (protoMod && protoMod.default.pb) {
                this._pb = protoMod.default.pb;
                this._startSync();
            } else {
                setTimeout(checkPb, 500);
            }
        };
        checkPb();
    };

    FruitWebSocket.prototype._startSync = function() {
        const sync = async () => {
            if (this.readyState !== 1) return;
            try {
                const res = await Parse.Cloud.run('fruit_game_info');
                if (res.code === 0) {
                    this._handleData(res.data);
                }
            } catch (e) { console.error('Sync Error', e); }
            setTimeout(sync, 2000);
        };
        sync();
    };

    FruitWebSocket.prototype._handleData = function(data) {
        if (!this._pb) return;
        const pb = this._pb;

        // 1. إرسال حالة اللعبة والوقت
        this._sendToGame('pb.FruitwheelGameInfoS2C', pb.FruitwheelGameInfoS2C.create({
            stage: data.stage,
            roundId: data.roundId,
            leftSeconds: data.leftSeconds,
            userCoin: data.userCoin,
            historyFruit: data.history,
            myselfBet: data.myselfBet,
            totalBet: data.totalBet
        }));

        // 2. إذا تغيرت المرحلة إلى FINISH، نرسل النتيجة
        if (data.stage === 3 && this._currentRoundId !== data.roundId) {
            this._currentRoundId = data.roundId;
            this._sendToGame('pb.FruitwheelGameResultS2A', pb.FruitwheelGameResultS2A.create({
                roundId: data.roundId,
                winId: data.history[0], // آخر نتيجة في السجل
                players: [] // يمكن إضافة قائمة الفائزين هنا
            }));
        }
    };

    FruitWebSocket.prototype.send = async function(buffer) {
        if (!this._pb) return;
        const msg = this._unpack(buffer);
        if (msg && msg.name.includes('GameBetC2S')) {
            const betData = this._pb.FruitwheelGameBetC2S.decode(msg.data);
            try {
                const res = await Parse.Cloud.run('fruit_game_bet', {
                    fruitId: betData.id,
                    amount: betData.bet
                });
                if (res.code === 0) {
                    this._sendToGame('pb.FruitwheelGameBetS2C', this._pb.FruitwheelGameBetS2C.create({
                        code: 0,
                        roundId: res.roundId,
                        id: res.fruitId,
                        bet: res.amount,
                        coin: res.newBalance
                    }));
                }
            } catch (e) {
                console.error('Bet Error', e);
            }
        }
    };

    FruitWebSocket.prototype._unpack = function(buffer) {
        const uint8 = new Uint8Array(buffer);
        const nameLen = (uint8[0] << 8) | uint8[1];
        let name = '';
        for (let i = 0; i < nameLen; i++) name += String.fromCharCode(uint8[2 + i]);
        return { name: name, data: uint8.slice(2 + nameLen) };
    };

    FruitWebSocket.prototype._sendToGame = function(name, message) {
        const protoClass = name.split('.').reduce((obj, key) => obj[key], this._pb);
        const encoded = protoClass.encode(message).finish();
        const nameBytes = new TextEncoder().encode(name);
        const packet = new Uint8Array(2 + nameBytes.length + encoded.length);
        packet[0] = (nameBytes.length >> 8) & 0xFF;
        packet[1] = nameBytes.length & 0xFF;
        packet.set(nameBytes, 2);
        packet.set(encoded, 2 + nameBytes.length);
        if (this.onmessage) this.onmessage({ data: packet.buffer });
    };

    window.WebSocket = function(url) {
        if (url.includes('/fruitwheel')) return new FruitWebSocket(url);
        return new OriginalWebSocket(url);
    };
})();
