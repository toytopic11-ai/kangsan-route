# 한줄 글영상 스튜디오

좋은 글을 넣으면 감성 사진 배경 위에 손글씨가 한 줄씩 써지는 10초 영상을 만들어 MP4로 저장합니다.

- `index.html` : 배포용 완성 파일 (이 파일 하나로 동작)
- `app.html` : Claude 미리보기용 원본 (index.html은 이 파일로 만들어짐)
- `netlify.toml` : Netlify 배포 설정

## Netlify 배포
1. app.netlify.com → Add new project → Import an existing project → GitHub → `kangsan-route`
2. Branch: `claude/serene-einstein-gb2lf4` (또는 main에 합친 뒤 main)
3. Base directory: `quote-video` / Build command: 비움 / Publish directory: `quote-video`
4. Deploy → 생성된 주소에서 Gemini API 키 입력 후 사용

API 키는 코드나 저장소에 넣지 말고, 배포된 앱 화면의 입력칸에만 넣으세요.
