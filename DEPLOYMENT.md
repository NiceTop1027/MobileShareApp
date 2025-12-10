# QuickShare 배포 가이드

## 🎯 크로스 플랫폼 지원

### ✅ 지원되는 플랫폼 조합
- **안드로이드 ↔ 안드로이드**: ✅ 완벽 지원
- **아이폰 ↔ 아이폰**: ✅ 완벽 지원
- **안드로이드 ↔ 아이폰**: ✅ 완벽 지원
- **PC ↔ 모바일**: ✅ 완벽 지원

### 🔧 기술적 구현
현재 앱은 **WebRTC P2P** 기술을 사용하여 플랫폼에 관계없이 파일 전송이 가능합니다:
- 브라우저/WebView 기반으로 작동
- STUN/TURN 서버를 통한 NAT traversal
- 직접 P2P 연결로 서버를 거치지 않음

---

## 📱 Android 앱 배포 (구글 플레이 스토어)

### 1단계: 프로덕션 빌드

```bash
# 웹 앱 빌드
npm run build

# Capacitor 동기화
npx cap sync android

# Android Studio 열기
npx cap open android
```

### 2단계: Android Studio에서 APK/AAB 생성

1. **Build > Generate Signed Bundle / APK** 선택
2. **Android App Bundle (AAB)** 선택 (플레이 스토어 권장)
3. 키스토어 생성 또는 기존 키스토어 선택:
   ```bash
   # 새 키스토어 생성 (한 번만 실행)
   keytool -genkey -v -keystore quickshare.keystore \
     -alias quickshare -keyalg RSA -keysize 2048 -validity 10000
   ```
4. 키스토어 정보 입력
5. **Release** 빌드 타입 선택
6. 빌드 완료

### 3단계: 플레이 스토어 업로드

1. [Google Play Console](https://play.google.com/console) 접속
2. 새 앱 만들기
3. 앱 정보 입력:
   - 앱 이름: **QuickShare**
   - 설명: **빠르고 안전한 P2P 파일 전송**
   - 카테고리: 도구
   - 스크린샷 업로드 (최소 2개)
4. AAB 파일 업로드
5. 콘텐츠 등급 받기
6. 가격 및 배포: 무료
7. 검토 제출

---

## 🍎 iOS 앱 배포 (앱 스토어)

### 1단계: iOS 플랫폼 추가

```bash
# iOS용 Capacitor 설치
npm install @capacitor/ios

# iOS 플랫폼 추가
npx cap add ios

# 빌드 및 동기화
npm run build
npx cap sync ios

# Xcode 열기
npx cap open ios
```

### 2단계: Xcode 설정

1. **Apple Developer** 계정 필요 (연간 $99)
2. Xcode에서 프로젝트 열기
3. **Signing & Capabilities** 탭:
   - Team 선택
   - Bundle Identifier 설정: `com.quickshare.app`
4. **Info.plist** 권한 추가:
   ```xml
   <key>NSPhotoLibraryUsageDescription</key>
   <string>파일을 저장하기 위해 사진 라이브러리 접근이 필요합니다</string>
   <key>NSCameraUsageDescription</key>
   <string>파일을 공유하기 위해 카메라 접근이 필요합니다</string>
   ```

### 3단계: 앱 스토어 업로드

1. Xcode에서 **Product > Archive**
2. Archive 완료 후 **Distribute App**
3. **App Store Connect** 선택
4. 업로드 완료
5. [App Store Connect](https://appstoreconnect.apple.com) 접속
6. 앱 정보 입력 및 스크린샷 업로드
7. 검토 제출

---

## 🌐 서버 배포 (프로덕션)

### 필수: 시그널링 서버

현재 `server/index.js`를 클라우드에 배포해야 합니다.

#### 옵션 1: Heroku 배포

```bash
# Heroku CLI 설치 후
heroku create quickshare-signal-server
heroku config:set NODE_ENV=production
heroku config:set CLIENT_ORIGIN=https://yourdomain.com
git push heroku main
```

#### 옵션 2: AWS EC2 / DigitalOcean

```bash
# SSH 접속 후
git clone <repository>
cd MobileShareApp
npm install
npm install -g pm2

# 환경 변수 설정
export PORT=3000
export NODE_ENV=production
export CLIENT_ORIGIN=https://yourdomain.com

# PM2로 서버 실행
pm2 start server/index.js --name quickshare-server
pm2 save
pm2 startup
```

#### 옵션 3: Vercel / Railway (권장)

```bash
# Railway CLI
railway init
railway up
```

### HTTPS 필수!
- WebRTC는 HTTPS 환경에서만 작동
- Let's Encrypt로 무료 SSL 인증서 발급
- 또는 Cloudflare 사용

---

## 📋 배포 전 체크리스트

### 보안
- [x] HTTPS 활성화
- [x] CORS 설정 (프로덕션 도메인만 허용)
- [x] Rate Limiting 설정
- [x] 입력 검증 및 Sanitization
- [x] XSS 방어
- [x] 파일 크기 제한 (100MB)
- [x] 실행 파일 차단

### 성능
- [x] 프로덕션 빌드 최적화
- [ ] CDN 사용 (선택사항)
- [x] 세션 만료 (5분)

### 앱 설정
- [x] 앱 아이콘 설정
- [x] 스플래시 화면
- [x] PWA manifest
- [x] 한글 지원
- [x] 학교 로고 표시

### 테스트
- [ ] Android 테스트
- [ ] iOS 테스트
- [ ] 안드로이드 ↔ 아이폰 크로스 플랫폼 테스트
- [ ] 파일 전송 테스트 (다양한 크기)
- [ ] 오프라인 복구 테스트

---

## 🔄 업데이트 배포

### Android
```bash
# 버전 업데이트
# android/app/build.gradle에서 versionCode, versionName 증가

npm run build
npx cap sync android
npx cap open android
# 새 AAB 빌드 후 플레이 스토어에 업로드
```

### iOS
```bash
# 버전 업데이트
# Xcode에서 Version, Build 번호 증가

npm run build
npx cap sync ios
npx cap open ios
# 새 Archive 후 앱 스토어에 업로드
```

---

## 📞 지원

- GitHub Issues: [리포지토리 URL]
- 이메일: support@quickshare.app

---

## 🎉 완료!

모든 단계를 완료하면:
- ✅ 안드로이드 사용자는 구글 플레이 스토어에서 다운로드
- ✅ 아이폰 사용자는 앱 스토어에서 다운로드
- ✅ 서로 다른 플랫폼 간 파일 공유 가능!
