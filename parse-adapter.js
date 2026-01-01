/**
 * Parse Adapter for Fruit Wheel Game
 * يتعامل مع الاتصال بـ Parse Server والمصادقة
 */

class FruitWheelAdapter {
  constructor() {
    this._initialized = false;
    this._parseInitialized = false;
    this._websocketCreated = false;
    this._protobufLoaded = false;
    this._retryCount = 0;
    this._maxRetries = 5;
    this._initTimeout = null;
    this._authenticated = false;
    this._sessionToken = null;

    // تسجيل الحالة في window
    window.FruitWheelAdapterStatus = {
      initialized: false,
      parseInitialized: false,
      websocketCreated: false,
      protobufLoaded: false,
      authenticated: false,
      errors: [],
      warnings: [],
      logs: [],
    };

    console.log('✅ [FruitWheel Adapter] تم إنشاء الـ Adapter');
    this._init();
  }

  _init() {
    console.log('🔄 [FruitWheel Adapter] بدء التهيئة...');

    // الحصول على معاملات الـ URL
    this._getUrlParameters();

    // التحقق من توفر Parse
    this._checkParseAvailable();

    // تحميل Protobuf
    this._loadProtobuf();

    // إنشاء WebSocket
    this._createWebSocket();

    // timeout للتهيئة
    this._initTimeout = setTimeout(() => {
      console.warn('⚠️ [FruitWheel Adapter] انتهت مهلة التهيئة (10 ثواني)');
      this._finishInit();
    }, 10000);
  }

  /**
   * الحصول على معاملات الـ URL
   */
  _getUrlParameters() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      
      this._sessionToken = urlParams.get('sessionToken');
      const appId = urlParams.get('appId');
      const serverURL = urlParams.get('serverURL');

      console.log('📋 [FruitWheel Adapter] معاملات الـ URL:');
      console.log('  🔑 Session Token:', this._sessionToken ? `✅ موجود (${this._sessionToken.substring(0, 20)}...)` : '❌ غير موجود');
      console.log('  📱 App ID:', appId ? `✅ ${appId}` : '❌ غير موجود');
      console.log('  🔗 Server URL:', serverURL ? `✅ ${serverURL}` : '❌ غير موجود');

      if (!this._sessionToken || !appId || !serverURL) {
        const error = 'معاملات الـ URL ناقصة';
        console.error('❌ [FruitWheel Adapter]', error);
        window.FruitWheelAdapterStatus.errors.push(error);
        return false;
      }

      // حفظ معاملات الـ URL
      window.parseAppId = appId;
      window.parseServerURL = serverURL;
      window.parseSessionToken = this._sessionToken;

      return true;
    } catch (e) {
      console.error('❌ [FruitWheel Adapter] خطأ في الحصول على معاملات الـ URL:', e);
      window.FruitWheelAdapterStatus.errors.push(e.message);
      return false;
    }
  }

  /**
   * التحقق من توفر Parse
   */
  _checkParseAvailable() {
    console.log('🔍 [FruitWheel Adapter] التحقق من توفر Parse...');

    if (typeof Parse === 'undefined') {
      console.warn('⚠️ [FruitWheel Adapter] Parse غير متاح حالياً، سيتم إعادة المحاولة');
      window.FruitWheelAdapterStatus.warnings.push('Parse not available yet');
      
      if (this._retryCount < this._maxRetries) {
        this._retryCount++;
        setTimeout(() => this._checkParseAvailable(), 500);
      } else {
        console.error('❌ [FruitWheel Adapter] فشل تحميل Parse بعد عدة محاولات');
        window.FruitWheelAdapterStatus.errors.push('Parse failed to load');
      }
      return;
    }

    console.log('✅ [FruitWheel Adapter] Parse متاح');
    this._initializeParse();
  }

  /**
   * تهيئة Parse
   */
  _initializeParse() {
    try {
      const appId = window.parseAppId;
      const serverURL = window.parseServerURL;
      const sessionToken = window.parseSessionToken;

      if (!appId || !serverURL || !sessionToken) {
        throw new Error('معاملات Parse ناقصة');
      }

      console.log('🔧 [FruitWheel Adapter] تهيئة Parse...');
      
      // تهيئة Parse
      Parse.initialize(appId);
      Parse.serverURL = serverURL;

      console.log('✅ [FruitWheel Adapter] تم تهيئة Parse بنجاح');
      window.FruitWheelAdapterStatus.parseInitialized = true;

      // المصادقة باستخدام sessionToken
      this._authenticateWithSessionToken(sessionToken);
    } catch (e) {
      console.error('❌ [FruitWheel Adapter] خطأ في تهيئة Parse:', e);
      window.FruitWheelAdapterStatus.errors.push(e.message);
    }
  }

  /**
   * المصادقة باستخدام sessionToken
   */
  _authenticateWithSessionToken(sessionToken) {
    try {
      console.log('🔐 [FruitWheel Adapter] محاولة المصادقة باستخدام sessionToken...');

      // طريقة 1: استخدام Parse.User.become
      Parse.User.become(sessionToken)
        .then((user) => {
          console.log('✅ [FruitWheel Adapter] تم المصادقة بنجاح');
          console.log('  👤 اسم المستخدم:', user.get('username'));
          console.log('  📧 البريد الإلكتروني:', user.get('email'));
          
          window.FruitWheelAdapterStatus.authenticated = true;
          this._authenticated = true;
          
          // تنفيذ callback إذا كان موجوداً
          if (typeof window.onParseAuthenticated === 'function') {
            window.onParseAuthenticated(user);
          }
        })
        .catch((error) => {
          console.error('❌ [FruitWheel Adapter] فشل المصادقة:', error);
          window.FruitWheelAdapterStatus.errors.push(error.message);
          
          // محاولة بديلة: تعيين sessionToken مباشرة
          this._setSessionTokenDirectly(sessionToken);
        });
    } catch (e) {
      console.error('❌ [FruitWheel Adapter] خطأ في المصادقة:', e);
      window.FruitWheelAdapterStatus.errors.push(e.message);
    }
  }

  /**
   * تعيين sessionToken مباشرة
   */
  _setSessionTokenDirectly(sessionToken) {
    try {
      console.log('🔧 [FruitWheel Adapter] محاولة تعيين sessionToken مباشرة...');

      // إنشاء مستخدم جديد وتعيين sessionToken
      const user = new Parse.User();
      user.sessionToken = sessionToken;

      // حفظ في localStorage
      localStorage.setItem('Parse/com.flamingolive.hus/currentUser', JSON.stringify({
        sessionToken: sessionToken,
      }));

      console.log('✅ [FruitWheel Adapter] تم تعيين sessionToken');
      window.FruitWheelAdapterStatus.authenticated = true;
      this._authenticated = true;
    } catch (e) {
      console.error('❌ [FruitWheel Adapter] خطأ في تعيين sessionToken:', e);
      window.FruitWheelAdapterStatus.errors.push(e.message);
    }
  }

  /**
   * تحميل Protobuf
   */
  _loadProtobuf() {
    console.log('📦 [FruitWheel Adapter] تحميل Protobuf...');

    const checkPb = () => {
      if (typeof dcodeIO !== 'undefined' && typeof dcodeIO.ByteBuffer !== 'undefined') {
        console.log('✅ [FruitWheel Adapter] Protobuf محمل بنجاح');
        window.FruitWheelAdapterStatus.protobufLoaded = true;
        this._protobufLoaded = true;
        return;
      }

      if (this._retryCount < this._maxRetries) {
        this._retryCount++;
        setTimeout(checkPb, 500);
      } else {
        console.warn('⚠️ [FruitWheel Adapter] فشل تحميل Protobuf، سيتم المتابعة بدونه');
        window.FruitWheelAdapterStatus.warnings.push('Protobuf failed to load');
      }
    };

    checkPb();
  }

  /**
   * إنشاء WebSocket
   */
  _createWebSocket() {
    try {
      console.log('🌐 [FruitWheel Adapter] إنشاء WebSocket...');

      // إنشاء MockWebSocket للاعتراض
      const originalWebSocket = window.WebSocket;

      window.FruitWebSocket = class extends originalWebSocket {
        constructor(url, protocols) {
          console.log('🔌 [FruitWebSocket] إنشاء اتصال:', url);
          super(url, protocols);

          this.addEventListener('open', () => {
            console.log('✅ [FruitWebSocket] تم فتح الاتصال');
            window.FruitWheelAdapterStatus.websocketCreated = true;
            
            if (typeof window.onFruitWebSocketOpen === 'function') {
              window.onFruitWebSocketOpen();
            }
          });

          this.addEventListener('message', (event) => {
            console.log('📨 [FruitWebSocket] استقبال رسالة:', event.data.substring(0, 100));
            
            if (typeof window.onFruitWebSocketMessage === 'function') {
              window.onFruitWebSocketMessage(event);
            }
          });

          this.addEventListener('error', (event) => {
            console.error('❌ [FruitWebSocket] خطأ في الاتصال:', event);
            window.FruitWheelAdapterStatus.errors.push('WebSocket error: ' + event.message);
            
            if (typeof window.onFruitWebSocketError === 'function') {
              window.onFruitWebSocketError(event);
            }
          });

          this.addEventListener('close', () => {
            console.log('🔌 [FruitWebSocket] تم إغلاق الاتصال');
            
            if (typeof window.onFruitWebSocketClose === 'function') {
              window.onFruitWebSocketClose();
            }
          });
        }
      };

      console.log('✅ [FruitWheel Adapter] تم إنشاء FruitWebSocket');
    } catch (e) {
      console.error('❌ [FruitWheel Adapter] خطأ في إنشاء WebSocket:', e);
      window.FruitWheelAdapterStatus.errors.push(e.message);
    }
  }

  /**
   * إنهاء التهيئة
   */
  _finishInit() {
    if (this._initTimeout) {
      clearTimeout(this._initTimeout);
    }

    this._initialized = true;
    window.FruitWheelAdapterStatus.initialized = true;

    console.log('✅ [FruitWheel Adapter] تم التهيئة بنجاح');
    console.log('📊 الحالة:', {
      initialized: window.FruitWheelAdapterStatus.initialized,
      parseInitialized: window.FruitWheelAdapterStatus.parseInitialized,
      authenticated: window.FruitWheelAdapterStatus.authenticated,
      websocketCreated: window.FruitWheelAdapterStatus.websocketCreated,
      protobufLoaded: window.FruitWheelAdapterStatus.protobufLoaded,
      errors: window.FruitWheelAdapterStatus.errors,
    });

    // تنفيذ callback إذا كان موجوداً
    if (typeof window.onFruitWheelAdapterReady === 'function') {
      window.onFruitWheelAdapterReady();
    }
  }

  /**
   * الحصول على حالة الـ Adapter
   */
  getStatus() {
    return window.FruitWheelAdapterStatus;
  }

  /**
   * إعادة تهيئة الـ Adapter
   */
  reinit() {
    console.log('🔄 [FruitWheel Adapter] إعادة التهيئة...');
    this._retryCount = 0;
    this._init();
  }
}

// إنشاء instance من الـ Adapter
console.log('🚀 [FruitWheel Adapter] بدء التحميل...');

// الانتظار حتى يكون document جاهز
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.fruitWheelAdapter = new FruitWheelAdapter();
  });
} else {
  window.fruitWheelAdapter = new FruitWheelAdapter();
}

// تصدير للاختبار
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FruitWheelAdapter;
}
