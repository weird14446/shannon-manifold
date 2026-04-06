import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type AppLanguage = 'en' | 'ko';

const STORAGE_KEY = 'shannon-manifold-language';

const TRANSLATIONS: Record<AppLanguage, Record<string, string>> = {
  en: {},
  ko: {
    'Shannon Manifold could not start.': 'Shannon Manifold를 시작할 수 없습니다.',
    'Refresh the page. If the issue persists, return to the Docker logs for the frontend service.':
      '페이지를 새로고침하세요. 문제가 계속되면 프런트엔드 서비스의 Docker 로그를 확인하세요.',
    'Admin': '관리자',
    'Community': '커뮤니티',
    'Projects': '프로젝트',
    'Lean Playground': '린 플레이그라운드',
    'Main Page': '메인 페이지',
    'Logout': '로그아웃',
    'Checking session...': '세션 확인 중...',
    'Login / Register': '로그인 / 회원가입',
    'Lean Playground is unavailable.': '린 플레이그라운드를 사용할 수 없습니다.',
    'The main dashboard is still available. Reload the page or return to the dashboard while the Lean runtime initializes.':
      '메인 대시보드는 계속 사용할 수 있습니다. Lean 런타임이 초기화되는 동안 페이지를 새로고침하거나 대시보드로 돌아가세요.',
    'Back to Dashboard': '대시보드로 돌아가기',
    'Retry Playground': '플레이그라운드 다시 시도',
    'Unified Project Filter': '통합 프로젝트 필터',
    'The selected project scope applies to both Verified Database and Lean Import Manifold.':
      '선택한 프로젝트 범위가 Verified Database와 Lean Import Manifold에 함께 적용됩니다.',
    'Project Scope': '프로젝트 범위',
    'All Projects': '모든 프로젝트',
    'Shared / No Project': '공유 / 프로젝트 없음',
    'Lean Import Manifold': 'Lean Import Manifold',
    'Visualized import relationships across verified user-uploaded Lean modules. Refresh when you want a new snapshot.':
      '검증된 Lean 모듈 간 import 관계를 시각화합니다. 최신 상태를 보려면 새로고침하세요.',
    'Refresh': '새로고침',
    'Select a verified code entry from the dashboard.': '대시보드에서 검증된 코드 항목을 선택하세요.',
    'Theorem Oracle': '정리 오라클',
    'Floating': '플로팅',
    'Dock left': '왼쪽 도킹',
    'Dock right': '오른쪽 도킹',
    'Docked': '도킹',
    'Switch to floating chat': '플로팅 챗으로 전환',
    'Switch to docked chat': '도킹 챗으로 전환',
    'Signed in as {name}': '{name} 계정으로 로그인됨',
    'Sign in to ask questions about Lean4, Rocq, and proofs.':
      'Lean4, Rocq, 증명에 대해 질문하려면 로그인하세요.',
    'Close chatbot': '챗봇 닫기',
    'Open chatbot': '챗봇 열기',
    'Verified Database': '검증 데이터베이스',
    'Open uploaded proofs and saved Lean playground modules in a dedicated code viewer.':
      '업로드된 증명과 저장된 Lean Playground 모듈을 전용 코드 뷰어에서 확인하세요.',
    '{count} items': '{count}개',
    '{visible} / {total} items': '{visible} / {total}개',
    'Project Filter': '프로젝트 필터',
    'All Verified Code': '전체 검증 코드',
    'Failed to load verified code.': '검증 코드를 불러오지 못했습니다.',
    'Failed to load the selected code entry.': '선택한 코드 항목을 불러오지 못했습니다.',
    'The requested code entry was not found.': '요청한 코드 항목을 찾을 수 없습니다.',
    'Loading verified code...': '검증 코드를 불러오는 중...',
    'Save code from the Lean Playground to populate this database.':
      'Lean Playground에서 코드를 저장하면 이 데이터베이스가 채워집니다.',
    'No verified code matches the selected project filter.':
      '선택한 프로젝트 필터에 맞는 검증 코드가 없습니다.',
    'Workspace module': '워크스페이스 모듈',
    'Cited by {count}': '피인용 {count}',
    'project': '프로젝트',
    'Your code': '내 코드',
    'Public': '공개',
    'Verified Code Viewer': '검증 코드 뷰어',
    'Back to Database': '데이터베이스로 돌아가기',
    'Remix to Playground': '플레이그라운드로 리믹스',
    'Hide Discussion': '토론 숨기기',
    'Show Discussion': '토론 보기',
    'Failed to save the code entry.': '코드 항목을 저장하지 못했습니다.',
    'Failed to delete the code entry.': '코드 항목을 삭제하지 못했습니다.',
    'Delete "{title}" from the verified database?': '검증 데이터베이스에서 "{title}"를 삭제하시겠습니까?',
    'Failed to load the PDF mapping for this code entry.':
      '이 코드 항목의 PDF 매핑을 불러오지 못했습니다.',
    'Saving...': '저장 중...',
    'Deleting...': '삭제 중...',
    'Edit': '수정',
    'Editable by you': '내가 수정 가능',
    'Read-only public code': '읽기 전용 공개 코드',
    'Lean Source': 'Lean 소스',
    'Title': '제목',
    'Lean module title': 'Lean 모듈 제목',
    'Original uploaded PDF': '원본 업로드 PDF',
    'Lean ↔ PDF Mapping': 'Lean ↔ PDF 매핑',
    'Generating PDF excerpts for the Lean declarations...':
      'Lean 선언에 대응하는 PDF 발췌문을 생성하는 중...',
    'Discuss This Mapping': '이 매핑 토론하기',
    'Hover a mapped Lean declaration to preview the corresponding PDF excerpt here.':
      '매핑된 Lean 선언에 마우스를 올리면 대응하는 PDF 발췌문을 여기서 미리 볼 수 있습니다.',
    'No PDF mapping could be generated for the current Lean declarations yet.':
      '현재 Lean 선언에 대한 PDF 매핑이 아직 생성되지 않았습니다.',
    'General': '일반',
    'Code': '코드',
    'PDF': 'PDF',
    'Theorem Discussion': '정리 토론',
    'No theorem-wide discussion has started yet.': '아직 정리 전체에 대한 토론이 시작되지 않았습니다.',
    'Code Discussions': '코드 토론',
    'No discussion threads exist for the selected declaration yet.':
      '선택한 선언에 대한 토론 쓰레드가 아직 없습니다.',
    'No declaration discussions exist for this theorem yet.':
      '이 정리에 대한 선언 토론이 아직 없습니다.',
    'Click a theorem / lemma / def declaration in the Lean source to start a thread for it.':
      'Lean 소스에서 theorem / lemma / def 선언을 클릭하면 해당 선언의 쓰레드를 시작할 수 있습니다.',
    'PDF Discussions': 'PDF 토론',
    'No discussion threads exist for the selected PDF anchor yet.':
      '선택한 PDF 앵커에 대한 토론 쓰레드가 아직 없습니다.',
    'No PDF discussions exist for this theorem yet.': '이 정리에 대한 PDF 토론이 아직 없습니다.',
    'Use a mapped PDF excerpt from the PDF panel to anchor a discussion thread.':
      'PDF 패널의 매핑된 발췌문을 사용해 토론 쓰레드를 고정하세요.',
    'Member Access': '멤버 접근',
    'Create an account or sign in to use the theorem oracle against the shared MySQL-backed member database.':
      '공유 MySQL 기반 멤버 데이터베이스에서 theorem oracle을 사용하려면 계정을 만들거나 로그인하세요.',
    'Login': '로그인',
    'Sign Up': '회원가입',
    'or continue with email': '또는 이메일로 계속하기',
    'Full name': '이름',
    'Email': '이메일',
    'Password': '비밀번호',
    'At least 8 characters': '최소 8자',
    'Working...': '처리 중...',
    'Create account': '계정 만들기',
    'Close authentication panel': '인증 패널 닫기',
    'Google did not return a usable credential.': 'Google에서 사용할 수 있는 인증 정보를 반환하지 않았습니다.',
    'Google login failed.': 'Google 로그인에 실패했습니다.',
    'Failed to initialize Google login.': 'Google 로그인을 초기화하지 못했습니다.',
    'Authentication failed.': '인증에 실패했습니다.',
    'Project title is required.': '프로젝트 제목은 필수입니다.',
    'Failed to load projects.': '프로젝트를 불러오지 못했습니다.',
    'Failed to load the project detail.': '프로젝트 상세를 불러오지 못했습니다.',
    'Failed to create the project.': '프로젝트를 생성하지 못했습니다.',
    'Failed to update the project.': '프로젝트를 수정하지 못했습니다.',
    'Failed to delete the project.': '프로젝트를 삭제하지 못했습니다.',
    'You do not have permission to delete this project.': '이 프로젝트를 삭제할 권한이 없습니다.',
    'Loading project detail...': '프로젝트 상세를 불러오는 중...',
    'PROJECT DETAIL': '프로젝트 상세',
    'Review the project participants and README.': '프로젝트 참가자와 README를 확인하세요.',
    'Back to Projects': '프로젝트로 돌아가기',
    'Edit Project': '프로젝트 수정',
    'Delete Project': '프로젝트 삭제',
    'Open GitHub': 'GitHub 열기',
    'Project title': '프로젝트 제목',
    'GitHub link': 'GitHub 링크',
    'Visibility': '공개 범위',
    'Private': '비공개',
    'README.md': 'README.md',
    'Save Changes': '변경 사항 저장',
    'Cancel': '취소',
    'Participants': '참가자',
    'Current project members tracked by the project manifest.':
      '프로젝트 manifest에 기록된 현재 프로젝트 멤버입니다.',
    'Project overview and usage notes saved in the project root.':
      '프로젝트 루트에 저장된 개요와 사용 메모입니다.',
    'Discussions': '토론',
    'Project Discussion': '프로젝트 토론',
    'README Discussion': 'README 토론',
    'Create Project': '프로젝트 생성',
    'Public projects are visible below even while signed out. Private projects remain hidden until you sign in.':
      '로그아웃 상태에서도 아래에서 공개 프로젝트를 볼 수 있습니다. 비공개 프로젝트는 로그인 전까지 숨겨집니다.',
    'Sign In': '로그인',
    'Open': '열기',
    'Open thread': '쓰레드 열기',
    'Close': '닫기',
    'Thread not found.': '쓰레드를 찾을 수 없습니다.',
    'Discussion thread not found.': '토론 쓰레드를 찾을 수 없습니다.',
    'Failed to load discussions.': '토론을 불러오지 못했습니다.',
    'Failed to load the discussion thread.': '토론 쓰레드를 불러오지 못했습니다.',
    'Start a new discussion...': '새 토론을 시작하세요...',
    'Start Thread': '쓰레드 시작',
    'Write a reply...': '답글을 작성하세요...',
    'Reply': '답글',
    'Delete': '삭제',
    'Resolve': '해결됨 처리',
    'Reopen': '다시 열기',
    'Active': '진행 중',
    'Resolved': '해결됨',
    'Open discussion': '토론 열기',
    'Login / Register to participate.': '참여하려면 로그인 / 회원가입이 필요합니다.',
    'Community Journal': '커뮤니티 저널',
    'Long-form mathematical notes, reviews, and project logs.':
      '긴 형식의 수학 노트, 리뷰, 프로젝트 로그를 공유하세요.',
    'Publish journal-style posts that cite verified theorems and projects without losing the artifact-first workflow of Shannon Manifold.':
      'Shannon Manifold의 산출물 중심 워크플로를 유지하면서, 검증된 정리와 프로젝트를 인용하는 저널 형식 글을 발행하세요.',
    'Write a Post': '글쓰기',
    'Drafts stay private until you publish.': '초안은 게시 전까지 비공개로 유지됩니다.',
    'Published posts are public. Sign in to write and comment.':
      '발행된 글은 공개됩니다. 글쓰기와 댓글을 위해 로그인하세요.',
    'Published': '발행됨',
    'Drafts': '초안',
    'Referenced Artifacts': '참조 산출물',
    'All': '전체',
    'Notes': '노트',
    'Theorem Reviews': '정리 리뷰',
    'Project Logs': '프로젝트 로그',
    'Papers': '논문',
    'Essays': '에세이',
    'Note': '노트',
    'Theorem Review': '정리 리뷰',
    'Project Log': '프로젝트 로그',
    'Paper': '논문',
    'Essay': '에세이',
    'Failed to load community posts.': '커뮤니티 글을 불러오지 못했습니다.',
    'Search titles, summaries, and markdown...': '제목, 요약, 마크다운을 검색하세요...',
    'Loading community posts...': '커뮤니티 글을 불러오는 중...',
    'Featured Post': '추천 글',
    'Latest Post': '최신 글',
    'Theorem': '정리',
    'Project': '프로젝트',
    'MY PAGE': '마이 페이지',
    'Member profile': '멤버 프로필',
    'Sign in to view your projects, verified code, and proof workspaces in one place.':
      '프로젝트, 검증 코드, proof workspace를 한 곳에서 보려면 로그인하세요.',
    'Login is required to open your account page.': '계정 페이지를 열려면 로그인이 필요합니다.',
    'Review your account profile, personal project space, and verified Lean assets.':
      '계정 프로필, 개인 프로젝트 공간, 검증된 Lean 산출물을 확인하세요.',
    'Profile': '프로필',
    'Update the name shown across the workspace and theorem database.':
      '워크스페이스와 theorem 데이터베이스에 표시되는 이름을 수정하세요.',
    'Display name': '표시 이름',
    'Your full name': '이름',
    'Administrator': '관리자',
    'Member': '멤버',
    'Joined {timestamp}': '{timestamp}에 가입',
    'Save Profile': '프로필 저장',
    'Failed to load your account page.': '계정 페이지를 불러오지 못했습니다.',
    'Failed to update your profile.': '프로필을 수정하지 못했습니다.',
    'ADMIN PAGE': '관리자 페이지',
    'Platform administration': '플랫폼 관리',
    'Administrator tools are only available to signed-in admin accounts.':
      '관리자 도구는 로그인된 관리자 계정에서만 사용할 수 있습니다.',
    'Login is required to access administrator controls.': '관리자 기능을 이용하려면 로그인이 필요합니다.',
    'Restricted access': '접근 제한',
    'This page is limited to administrator accounts configured for the platform.':
      '이 페이지는 플랫폼에 설정된 관리자 계정만 접근할 수 있습니다.',
    'Your current account does not have administrator privileges.':
      '현재 계정에는 관리자 권한이 없습니다.',
    'Platform Administration': '플랫폼 관리',
    'Monitor platform usage, inspect project visibility, and manage administrator roles.':
      '플랫폼 사용 현황을 모니터링하고, 프로젝트 공개 범위를 확인하며, 관리자 권한을 관리하세요.',
    'Failed to load admin overview.': '관리자 개요를 불러오지 못했습니다.',
    'Failed to update administrator role.': '관리자 권한을 수정하지 못했습니다.',
    'Failed to delete the user.': '사용자를 삭제하지 못했습니다.',
    'Failed to delete the verified code entry.': '검증 코드 항목을 삭제하지 못했습니다.',
    'Users': '사용자',
    'Admins': '관리자',
    'Public Projects': '공개 프로젝트',
    'Private Projects': '비공개 프로젝트',
    'Proof Workspaces': 'Proof Workspace',
    'PDF Workspaces': 'PDF Workspace',
    'Project Modules': '프로젝트 모듈',
    'Using your Lean project context': '내 Lean 프로젝트 문맥 사용 중',
    'Using a public Lean project context': '공개 Lean 프로젝트 문맥 사용 중',
    'Loaded from your proof workspace': '내 proof workspace에서 불러옴',
    'Loaded from a shared URL': '공유 URL에서 불러옴',
    'Loaded from an uploaded Lean file': '업로드한 Lean 파일에서 불러옴',
    'Lean workspace document': 'Lean workspace 문서',
    'Booting Lean': 'Lean 시작 중',
    'Local Only': '로컬 전용',
    'Cancel Upload': '업로드 취소',
    'Saved in Verified DB': 'Verified DB에 저장됨',
    'Browse the verified Lean modules inside the selected project.':
      '선택한 프로젝트 안의 검증된 Lean 모듈을 둘러보세요.',
    'Search modules': '모듈 검색',
    'Filter by title, path, or module': '제목, 경로, 모듈명으로 필터링',
    'Loading modules...': '모듈을 불러오는 중...',
    'No verified Lean modules were found in this project yet.':
      '이 프로젝트에는 아직 검증된 Lean 모듈이 없습니다.',
    'No verified modules match the current search.': '현재 검색에 맞는 검증 모듈이 없습니다.',
    'entry': '엔트리',
    'Infoview': '인포뷰',
    'Hide UI': 'UI 숨기기',
    'Show UI': 'UI 보기',
    'Goals, messages, tactics, and diagnostics from the Lean server. Place the cursor inside a theorem or `by` block to inspect the current proof state.':
      'Lean 서버의 goal, 메시지, tactic, 진단 정보를 표시합니다. 현재 증명 상태를 보려면 커서를 theorem 또는 `by` 블록 안에 두세요.',
    'Loading projects...': '프로젝트를 불러오는 중...',
    'No project': '프로젝트 없음',
    'Sign in to select a project': '프로젝트를 선택하려면 로그인하세요',
    'Projects here are used as Lean import context and verified DB grouping only.':
      '여기서 선택한 프로젝트는 Lean import 문맥과 verified DB 분류에만 사용됩니다.',
    'File': '파일',
    'Document': '문서',
    'Lean file name': 'Lean 파일 이름',
    'Lean document title': 'Lean 문서 제목',
    'Save': '저장',
    'Projects group Lean files. Saving here publishes the current Lean code to the verified database under the active project.':
      '프로젝트는 Lean 파일을 묶는 단위입니다. 여기서 저장하면 현재 Lean 코드가 활성 프로젝트 아래 verified database에 게시됩니다.',
    'Save the current Lean code to the verified database. If a PDF is attached, the verified detail view will show both side by side.':
      '현재 Lean 코드를 verified database에 저장합니다. PDF가 첨부되어 있으면 상세 뷰에서 둘을 나란히 볼 수 있습니다.',
    'Save to Verified DB': 'Verified DB에 저장',
    'Building...': '빌드 중...',
    'Queued...': '대기 중...',
    'The attached PDF will be stored together with this Lean code in the verified database.':
      '첨부된 PDF도 현재 Lean 코드와 함께 verified database에 저장됩니다.',
    'Upload Code': '코드 업로드',
    'Replace PDF': 'PDF 교체',
    'Upload PDF': 'PDF 업로드',
    'Restart Lean': 'Lean 재시작',
    'Reset': '초기화',
    'Link Copied': '링크 복사됨',
    'Share URL': 'URL 공유',
    'Open Link': '링크 열기',
    '{count} lines': '{count}줄',
    'Workspace File': '워크스페이스 파일',
    'Owner `{owner}` · Visibility `{visibility}`': '소유자 `{owner}` · 공개 범위 `{visibility}`',
    'Package `{pkg}` · Entry `{entry}`': '패키지 `{pkg}` · 엔트리 `{entry}`',
    'This public project is open read-only. Save to `Verified DB` if you want to keep your own copy of the current code.':
      '이 공개 프로젝트는 읽기 전용입니다. 현재 코드의 사본을 보관하려면 `Verified DB`에 저장하세요.',
    'GitHub Link': 'GitHub 링크',
    'This project keeps its own repository link. Saving the link does not push code.':
      '이 프로젝트는 자체 저장소 링크만 보관합니다. 링크를 저장해도 코드는 push되지 않습니다.',
    'Repository URL': '저장소 URL',
    'Saving Link...': '링크 저장 중...',
    'Save Link': '링크 저장',
    'PDF Preview': 'PDF 미리보기',
    'Open PDF': 'PDF 열기',
    'Download PDF': 'PDF 다운로드',
    'Download': '다운로드',
    'This PDF is attached only in the playground right now. Use Save to Verified DB to store it together with the current Lean code, then inspect both in split view from the verified database.':
      '이 PDF는 현재 플레이그라운드에만 임시 첨부된 상태입니다. 현재 Lean 코드와 함께 저장하려면 `Verified DB에 저장`을 사용하세요. 이후 verified database에서 둘을 스플릿 뷰로 확인할 수 있습니다.',
    'Saved PDF': '저장된 PDF',
    'This PDF is already linked to the verified database entry for the current code. Opening that entry will show the Lean code and PDF side by side.':
      '이 PDF는 현재 코드의 verified database 항목에 이미 연결되어 있습니다. 해당 항목을 열면 Lean 코드와 PDF를 나란히 볼 수 있습니다.',
    'Source PDF': '원본 PDF',
    'Linked from Source': '원본에서 연결됨',
    'This PDF is linked from the current source artifact and stays read-only in the playground.':
      '이 PDF는 현재 원본 산출물에서 연결된 것이며, 플레이그라운드에서는 읽기 전용으로 유지됩니다.',
    'Copilot Focus': '코파일럿 포커스',
    'Move the cursor inside a theorem or `by` block to send the active goal to the Oracle.':
      '커서를 theorem 또는 `by` 블록 안에 두면 현재 goal이 Oracle로 전달됩니다.',
    'Imports': 'Imports',
    'Project files keep the `import <Package>.Main` convention and build inside the selected project root.':
      '프로젝트 파일은 `import <Package>.Main` 규칙을 유지하며 선택한 프로젝트 루트 안에서 빌드됩니다.',
    'Save from the playground, then import any module below from the shared Lean workspace.':
      '플레이그라운드에서 저장한 뒤, 아래 모듈들을 공유 Lean workspace에서 import하세요.',
    'Share': '공유',
    'Copy a URL that reopens the selected project root and file.':
      '선택한 프로젝트 루트와 파일을 다시 여는 URL을 복사합니다.',
    'Copy a URL snapshot of the current code, similar to the official Lean live editor.':
      '공식 Lean live editor처럼 현재 코드의 URL 스냅샷을 복사합니다.',
    'Container': '컨테이너',
    'The Lean server runs in the dedicated Docker service on port 8080.':
      'Lean 서버는 8080 포트의 전용 Docker 서비스에서 실행됩니다.',
    'Keep project decisions attached to the project itself instead of a separate board.':
      '별도 게시판이 아니라 프로젝트 자체에 결정과 토론을 남기세요.',
    'No project-wide discussion has started yet.': '아직 프로젝트 전체 토론이 시작되지 않았습니다.',
    'No README discussion threads exist for this project yet.':
      '이 프로젝트에는 아직 README 토론 쓰레드가 없습니다.',
    'Click a project card to open its detail page with participants and README.':
      '프로젝트 카드를 클릭하면 참가자와 README가 있는 상세 페이지가 열립니다.',
    'Browse public projects without signing in. Sign in only if you want to create or manage projects.':
      '로그인하지 않아도 공개 프로젝트를 둘러볼 수 있습니다. 생성이나 관리를 원할 때만 로그인하세요.',
    'Create a project to scaffold Package/Main.lean and README.md.':
      '프로젝트를 생성하면 Package/Main.lean과 README.md가 scaffold됩니다.',
    'No public projects are available yet.': '아직 공개 프로젝트가 없습니다.',
    'yours': '내 프로젝트',
    'Entry module: {name}': '엔트리 모듈: {name}',
    'Close project panel': '프로젝트 패널 닫기',
    'Write a comment to start a discussion thread.': '토론 쓰레드를 시작하려면 댓글을 작성하세요.',
    'Failed to create the discussion thread.': '토론 쓰레드를 생성하지 못했습니다.',
    'Write a reply before posting.': '등록하기 전에 답글을 작성하세요.',
    'Failed to post the reply.': '답글을 등록하지 못했습니다.',
    'Failed to update the discussion status.': '토론 상태를 수정하지 못했습니다.',
    'Delete this comment?': '이 댓글을 삭제하시겠습니까?',
    'Failed to delete the comment.': '댓글을 삭제하지 못했습니다.',
    'Replying to {name}': '{name}에게 답글 작성 중',
    'Discuss the current artifact as a whole.': '현재 산출물 전체를 대상으로 토론합니다.',
    'Sign in to start a thread or reply.': '쓰레드 시작이나 답글 작성을 하려면 로그인하세요.',
    'Select an anchor before starting a discussion thread.':
      '토론 쓰레드를 시작하기 전에 앵커를 먼저 선택하세요.',
    'Start a new anchored discussion...': '앵커가 연결된 새 토론을 시작하세요...',
    'Loading threads...': '쓰레드를 불러오는 중...',
    'Outdated': '오래됨',
    'Updated {timestamp}': '{timestamp}에 업데이트',
    'Opened': '열림',
    'Loading discussion...': '토론을 불러오는 중...',
    'Started by {name} · {timestamp}': '{name}이(가) 시작 · {timestamp}',
    'Sign in to reply.': '답글을 달려면 로그인하세요.',
  },
};

interface I18nContextValue {
  language: AppLanguage;
  locale: string;
  setLanguage: (language: AppLanguage) => void;
  t: (key: string, vars?: Record<string, string | number | null | undefined>) => string;
  formatDate: (value: string | number | Date | null | undefined) => string;
  formatDateTime: (value: string | number | Date | null | undefined) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const interpolate = (
  template: string,
  vars?: Record<string, string | number | null | undefined>,
) => {
  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key) => `${vars[key] ?? ''}`);
};

export const detectInitialLanguage = (): AppLanguage => {
  if (typeof window === 'undefined') {
    return 'en';
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'ko') {
    return stored;
  }

  return window.navigator.language?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
};

export const translateStatic = (
  language: AppLanguage,
  key: string,
  vars?: Record<string, string | number | null | undefined>,
) => interpolate(TRANSLATIONS[language][key] ?? key, vars);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(() => detectInitialLanguage());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language === 'ko' ? 'ko' : 'en';
  }, [language]);

  const locale = language === 'ko' ? 'ko-KR' : 'en-US';

  const t = useCallback<I18nContextValue['t']>(
    (key, vars) => translateStatic(language, key, vars),
    [language],
  );

  const formatDate = useCallback<I18nContextValue['formatDate']>(
    (value) => {
      if (!value) {
        return '';
      }
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }).format(new Date(value));
    },
    [locale],
  );

  const formatDateTime = useCallback<I18nContextValue['formatDateTime']>(
    (value) => {
      if (!value) {
        return '';
      }
      return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value));
    },
    [locale],
  );

  const contextValue = useMemo<I18nContextValue>(
    () => ({
      language,
      locale,
      setLanguage,
      t,
      formatDate,
      formatDateTime,
    }),
    [formatDate, formatDateTime, language, locale, t],
  );

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};
