import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import path from 'path';
import OpenAI from "openai";
import dotenv from "dotenv";import { fileURLToPath } from "url";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Constants
const USER_IDS = ["dooley957", "pss6161", "zcbm1998", "yhwon12", "falseman"];
const USER_NAMES = {
  "dooley957": "나영",
  "pss6161": "지원",
  "zcbm1998": "경보",
  "yhwon12": "하영",
  "falseman": "규영"
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// 난이도 매핑
const DIFFICULTY_RANGES = {
  low: { min: 6, max: 8 },      // 실버 3-1
  mid: { min: 11, max: 13 },    // 골드 5-3
  high: { min: 14, max: 16 }    // 골드 3-1
};

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Utility function: Check if a user solved a problem
async function hasSolvedProblem(userId, problemId) {
  const url = `https://www.acmicpc.net/status?user_id=${userId}&problem_id=${problemId}&result_id=4`;
  console.log(`Checking ${userId} for problem ${problemId}`);

  try {
    const response = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000
    });

    const $ = cheerio.load(response.data);
    const rows = $('table.table tbody tr');

    await new Promise(resolve => setTimeout(resolve, 500));

    return rows.length > 0;
  } catch (error) {
    console.error(`Error checking ${userId} for problem ${problemId}:`, error.message);
    return 'Error';
  }
}

// API endpoint: Check problem
app.post('/api/check-problem', async (req, res) => {
  const { problemId } = req.body;

  if (!problemId || !/^\d+$/.test(problemId)) {
    return res.status(400).json({ error: '유효한 문제 번호를 입력해주세요.' });
  }

  try {
    const solvedUsers = [];
    const unsolvedUsers = [];
    const errorUsers = [];

    for (const userId of USER_IDS) {
      const status = await hasSolvedProblem(userId, problemId);
      
      if (status === 'Error') {
        errorUsers.push(userId);
      } else if (status) {
        solvedUsers.push(userId);
      } else {
        unsolvedUsers.push(userId);
      }
    }

    const result = {
      problemId,
      solved: solvedUsers.map(id => ({
        id,
        name: USER_NAMES[id]
      })),
      unsolved: unsolvedUsers.map(id => ({
        id,
        name: USER_NAMES[id]
      })),
      errors: errorUsers.map(id => ({
        id,
        name: USER_NAMES[id]
      }))
    };

    res.json(result);
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// API endpoint: Get user info (tier)
app.get('/api/user-info/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const response = await axios.get(`https://solved.ac/api/v3/user/show?handle=${userId}`);
    res.json({
      tier: response.data.tier,
      handle: response.data.handle,
      bio: response.data.bio,
      solvedCount: response.data.solvedCount,
      rating: response.data.rating
    });
  } catch (error) {
    console.error('Error fetching user info:', error.message);
    res.status(500).json({ error: '유저 정보를 가져올 수 없습니다.' });
  }
});

// ✅ yhwon12 취약 유형 분석 및 문제 추천 API
app.get("/api/analyze-and-recommend/:userId", async (req, res) => {
  const { userId } = req.params;
  const { difficulty = "mid" } = req.query;

  try {
    // 1. 유저가 푼 모든 문제 ID 수집
    console.log(`📥 ${userId}의 전체 풀이 내역 가져오는 중...`);
    
    let allSolvedProblems = [];
    let page = 1;
    let hasMore = true;
    
    // 모든 페이지 순회하며 문제 수집
    while (hasMore) {
      try {
        const response = await axios.get(
          `https://solved.ac/api/v3/search/problem?query=solved_by:${userId}&sort=id&direction=asc&page=${page}`,
          { timeout: 10000 }
        );
        
        const problems = response.data.items;
        
        if (problems.length === 0) {
          hasMore = false;
        } else {
          allSolvedProblems = allSolvedProblems.concat(problems);
          console.log(`📄 페이지 ${page}: ${problems.length}개 문제 수집 (총 ${allSolvedProblems.length}개)`);
          page++;
          
          // API 속도 제한 방지
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (error) {
        console.error(`페이지 ${page} 로드 실패:`, error.message);
        hasMore = false;
      }
    }

    // 2. 풀이한 문제 ID만 추출
    const solvedProblemIds = allSolvedProblems.map(p => p.problemId);
    console.log(`✅ 총 ${solvedProblemIds.length}개 문제 풀이 확인`);

    // 3. 난이도 범위 설정
    const range = DIFFICULTY_RANGES[difficulty];
    const difficultyText = {
      low: "실버 3~1",
      mid: "골드 5~3",
      high: "골드 3~1",
    }[difficulty];

    // 4. 해당 난이도의 한국어 문제 목록 가져오기
    console.log(`🔍 ${difficultyText} 난이도 한국어 문제 검색 중...`);
    
    let candidateProblems = [];
    for (let tier = range.min; tier <= range.max; tier++) {
      try {
        // 여러 페이지에서 문제 수집
        for (let page = 1; page <= 3; page++) {
          const response = await axios.get(
            `https://solved.ac/api/v3/search/problem?query=tier:${tier}&sort=random&direction=asc&page=${page}`,
            { timeout: 10000 }
          );
          
          const problems = response.data.items.filter(p => {
            const hasKoreanTitle = p.titleKo && p.titleKo.trim() !== '';
            const notSolved = !solvedProblemIds.includes(p.problemId);
            const isKorean = /[가-힣]/.test(p.titleKo); // 한글이 포함되어 있는지 확인
            
            return hasKoreanTitle && notSolved && isKorean;
          });
          
          candidateProblems = candidateProblems.concat(problems);
          
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        console.log(`  Tier ${tier}: ${candidateProblems.filter(p => p.level === tier).length}개 후보 문제 발견`);
        
      } catch (error) {
        console.error(`Tier ${tier} 검색 실패:`, error.message);
      }
    }

    console.log(`✅ 총 ${candidateProblems.length}개 후보 문제 수집 완료`);

    if (candidateProblems.length === 0) {
      return res.status(404).json({ 
        error: '추천할 수 있는 문제가 없습니다.',
        totalSolved: solvedProblemIds.length 
      });
    }

    // 5. 문제 유형 분석을 위한 샘플 데이터 (최근 100개)
    const sampleProblems = allSolvedProblems.slice(-100);

    // 6. AI 프롬프트 작성 - 실제 문제 목록 제공
    const prompt = `
당신은 백준 온라인 저지 문제 분석 전문가입니다.

**1단계: 유저 분석**
아래는 백준 유저 ${userId}가 최근에 푼 문제 샘플입니다.
${JSON.stringify(sampleProblems, null, 2)}

이 데이터를 분석하여 **취약한 알고리즘 유형 3가지**를 한국어로 찾아주세요.
(예: "다이나믹 프로그래밍", "그래프 탐색", "그리디 알고리즘" 등)

**2단계: 문제 선택**
아래는 유저가 아직 풀지 않은 ${difficultyText} 난이도의 실제 백준 문제 목록입니다.
${JSON.stringify(candidateProblems.slice(0, 50).map(p => ({
  problemId: p.problemId,
  title: p.titleKo,
  tier: p.level,
  tags: p.tags.map(t => t.displayNames[0]?.name || t.key)
})), null, 2)}

위 실제 문제 목록에서 취약 유형에 해당하는 문제 **3개만 선택**해주세요.

**응답은 반드시 아래 JSON 형식으로만 출력하세요:**

{
  "weaknesses": ["취약유형1", "취약유형2", "취약유형3"],
  "recommended": [
    {
      "problemId": 1234,
      "title": "문제 제목",
      "tier": 12,
      "tags": ["태그1", "태그2"]
    }
  ]
}

**필수 조건:**
- JSON 형식만 출력하고 다른 설명은 포함하지 마세요.
- recommended 배열에는 위에 제공된 실제 문제 목록에서만 선택해야 합니다.
- problemId, title, tier, tags 모두 위 목록의 실제 값을 사용하세요.
`;

    // 7. OpenAI 호출
    console.log(`🤖 AI 분석 시작...`);
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const text = aiResponse.choices[0].message.content.trim();
    
    // JSON 추출 (코드 블록 제거)
    let jsonText = text;
    if (text.includes('```json')) {
      jsonText = text.split('```json')[1].split('```')[0].trim();
    } else if (text.includes('```')) {
      jsonText = text.split('```')[1].split('```')[0].trim();
    }

    // 8. JSON 파싱 및 검증
    const data = JSON.parse(jsonText);
    
    // 추천된 문제가 실제 후보 목록에 있는지 검증
    const validRecommendations = data.recommended.filter(p => 
      candidateProblems.some(c => c.problemId === p.problemId)
    );
    
    console.log(`✅ 분석 완료: ${validRecommendations.length}개 문제 추천`);
    
    res.json({
      weaknesses: data.weaknesses,
      recommended: validRecommendations,
      totalSolved: solvedProblemIds.length,
      totalCandidates: candidateProblems.length
    });
    
  } catch (err) {
    console.error("❌ AI 분석 및 추천 실패:", err.message);
    console.error(err.stack);
    res.status(500).json({ error: "AI 분석 및 추천 생성 실패: " + err.message });
  }
});

// 기본 페이지
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 서버 실행
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 서버가 포트 ${PORT}에서 실행 중`);
});