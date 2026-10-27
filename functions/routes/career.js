// ================================================================
// Career Launchpad routes: resume tools, LinkedIn posts, interview coach.
// Extracted from server.js - register() mounts them on the shared app.
// ================================================================
import {
  requireAuth, enforceWordLimit, enforceDailyAILimit, aiLimiter,
  reserveUsage, refundUsage, llamaChat,
} from './shared.js';

export function register(app) {
  // Career: Rate Resume -> { score, summary, strengths, improvements } - TRACKS USAGE
  app.post('/career/rate-resume', requireAuth, enforceWordLimit, aiLimiter, enforceDailyAILimit, async (req, res) => {
    try {
      const { html, text, role } = req.body ?? {};
      const uid = req.authUid;
      const content = (typeof html === 'string' && html.trim()) ? html.trim() : (typeof text === 'string' ? text.trim() : '');
      if (!content) return res.status(400).json({ error: 'html or text required' });
      const rsv = await reserveUsage(uid);
      req._usageConsumed = rsv.consumed;
      if (!rsv.allowed) return res.status(403).json({ error: rsv.error });

      // Strip tags for model input but include signal that structure existed
      const plain = String(content)
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const sys = 'You are an ATS-savvy resume reviewer. Be realistic and concise. When asked for examples, extract short original snippets from the resume and rewrite them with metrics and strong action verbs.';
      const usr = `Evaluate this resume${role?` for the role of ${role}`:''}. Provide:
  - A score 0-100 (ATS and recruiter friendliness)
  - A short summary (3-5 sentences)
  - 3-5 specific strengths
  - 3-5 prioritized improvements
  - 2-3 example rewrites: each with {"original":"...","improved":"...","rationale":"..."}. Keep each snippet under 300 characters, and the improved version should add metrics or outcomes when possible.
  Return STRICT JSON only as {"score":0-100,"summary":"...","strengths":["..."],"improvements":["..."],"examples":[{"original":"...","improved":"...","rationale":"..."}]}.

  Resume (plain text extracted):\n${plain}`;
      const raw = await llamaChat([ { role: 'system', content: sys }, { role: 'user', content: usr } ], { temperature: 0.3, response_format: { type: 'json_object' } });
      let data;
      try { data = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { data = JSON.parse(m[0]); } catch {} } }
      const score = Math.max(0, Math.min(100, Number(data?.score || 0)));
      const summary = String(data?.summary || '');
      const strengths = Array.isArray(data?.strengths) ? data.strengths.filter(Boolean).slice(0,5) : [];
      const improvements = Array.isArray(data?.improvements) ? data.improvements.filter(Boolean).slice(0,5) : [];
      const examples = Array.isArray(data?.examples) ? data.examples
        .map((e) => ({
          original: String(e?.original || ''),
          improved: String(e?.improved || ''),
          rationale: String(e?.rationale || '')
        }))
        .filter((e) => e.original && e.improved)
        .slice(0, 3) : [];
      
      return res.json({ score, summary, strengths, improvements, examples });
    } catch (e) {
      try { await refundUsage(req.authUid, req._usageConsumed); } catch {}
      res.status(500).json({ error: e?.message || 'Failed to rate resume' });
    }
  });

  // Career Planner: recommend jobs from resume text -> { recommendations: [{title, reasoning}] } - TRACKS USAGE
  app.post('/career/planner', requireAuth, enforceWordLimit, aiLimiter, enforceDailyAILimit, async (req, res) => {
    try {
      const { resume_text } = req.body ?? {};
      const uid = req.authUid;
      if (!resume_text || typeof resume_text !== 'string' || resume_text.trim().length < 10) {
        return res.status(400).json({ error: 'resume_text required' });
      }
      const rsv = await reserveUsage(uid);
      req._usageConsumed = rsv.consumed;
      if (!rsv.allowed) return res.status(403).json({ error: rsv.error });
      const raw = await llamaChat([
          { role: 'system', content: 'You are a career advisor. Suggest realistic job roles from a resume and explain fit clearly.' },
          { role: 'user', content: `From the following resume content, recommend exactly 5 job roles that fit the candidate. For each, provide a 4-5 sentence reasoning that references their skills and experience. Keep titles standard (e.g., "Software Engineer", "Data Analyst").\nReturn STRICT JSON: {"recommendations":[{"title":"...","reasoning":"..."}]}.\n\nResume:\n${resume_text}` }
      ], { temperature: 0.5, response_format: { type: 'json_object' } });
      const parsed = JSON.parse(raw);
      const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0,5) : [];
      
      res.json({ recommendations });
    } catch (e) {
      try { await refundUsage(req.authUid, req._usageConsumed); } catch {}
      res.status(500).json({ error: e?.message || 'Failed to generate career plan' });
    }
  });

  // Career: LinkedIn -> { variations: string[] } - TRACKS USAGE
  app.post('/career/linkedin', requireAuth, enforceWordLimit, aiLimiter, enforceDailyAILimit, async (req, res) => {
    try {
      const { topic, tone, post_type, viral_boost } = req.body ?? {};
      const uid = req.authUid;
      const cleanTopic = typeof topic === 'string' ? topic.trim().slice(0, 200) : '';
      if (!cleanTopic) return res.status(400).json({ error: 'Topic is required' });
      const rsv = await reserveUsage(uid);
      req._usageConsumed = rsv.consumed;
      if (!rsv.allowed) return res.status(403).json({ error: rsv.error });
      const toneSafe = (typeof tone === 'string' && tone.trim()) ? tone.trim().slice(0, 40) : 'Professional';
      const typeSafe = (typeof post_type === 'string' && post_type.trim()) ? post_type.trim().toLowerCase() : 'general';
      const boost = !!viral_boost;

      // Build guidance based on post type
      const typeGuidance = {
        'project_update': 'Share progress, key learnings, and a call-to-action. Keep it humble and data-driven.',
        'achievement': 'Announce the milestone with gratitude, highlight what you learned, and invite conversation.',
        'learning_experience': 'Share a take-away, a short example, and a question to engage peers.',
        'general': 'Provide a concise, thoughtful update with a clear takeaway.',
      }[typeSafe] || 'Provide a concise, thoughtful update with a clear takeaway.';

      const boostGuidance = boost
        ? 'Use a compelling hook in the first line, tasteful emoji (max 3), and 2-3 relevant hashtags.'
        : 'Avoid emojis and hashtags.';

      const sys = 'You are a LinkedIn writing assistant. You write in a professional yet human tone, avoid buzzwords, and keep posts skimmable with short paragraphs.';
      const usr = `Create three distinct LinkedIn post variations about: "${cleanTopic}".
  Tone: ${toneSafe}
  Post type: ${typeSafe}
  Guidance: ${typeGuidance}
  ${boostGuidance}

  Rules:
  - 90-180 words each.
  - No markdown headings.
  - No code fences.
  - No placeholders.
  Output JSON strictly as {"variations":["post1","post2","post3"]}`;

      const raw = await llamaChat([
          { role: 'system', content: sys },
          { role: 'user', content: usr },
      ], { temperature: 0.7, response_format: { type: 'json_object' } });
      let data;
      try { data = JSON.parse(raw); } catch { data = {}; }
      const variations = Array.isArray(data.variations) ? data.variations.filter(v => typeof v === 'string') : [];
      if (variations.length < 1) {
        try { await refundUsage(uid, rsv.consumed); } catch {}
        return res.status(500).json({ error: 'Failed to generate posts' });
      }
      
      res.json({ variations });
    } catch (e) {
      try { await refundUsage(req.authUid, req._usageConsumed); } catch {}
      res.status(500).json({ error: e?.message || 'Failed to generate posts' });
    }
  });

  // Interview Coach: start -> { questions } - TRACKS USAGE
  app.post('/career/interview/start', requireAuth, enforceWordLimit, aiLimiter, enforceDailyAILimit, async (req, res) => {
    try {
      const { interview_type, job_title, company_name } = req.body ?? {};
      const uid = req.authUid;
      const rsv = await reserveUsage(uid);
      req._usageConsumed = rsv.consumed;
      if (!rsv.allowed) return res.status(403).json({ error: rsv.error });
      const t = interview_type || 'Technical';
      const role = job_title || 'Candidate';
      const company = company_name || '';
      const raw = await llamaChat([
          { role: 'system', content: 'You are an expert recruiter. Generate realistic interview questions.' },
          { role: 'user', content: `Generate 5-10 interview questions for a ${role}.\nInterview type: ${t}\nCompany: ${company || 'unspecified'}\nIf type is Behavioral, prefer STAR (Situation, Task, Action, Result) prompts.\nReturn STRICT JSON: {"questions":["..."]}` }
      ], { temperature: 0.4, response_format: { type: 'json_object' } });
      const parsed = JSON.parse(raw);
      const questions = Array.isArray(parsed.questions) ? parsed.questions.slice(0, 10) : [];
      
      res.json({ questions });
    } catch (e) {
      try { await refundUsage(req.authUid, req._usageConsumed); } catch {}
      res.status(500).json({ error: e?.message || 'Failed to start interview' });
    }
  });

  // Interview Coach: evaluate answer -> { clarity, confidence, relevance, feedback, improved }
  app.post('/career/interview/answer', requireAuth, enforceWordLimit, aiLimiter, enforceDailyAILimit, async (req, res) => {
    try {
      const { question, answer, feedback_tone } = req.body ?? {};
      if (!question || !answer) return res.status(400).json({ error: 'question and answer required' });
      const tone = feedback_tone || 'Professional';
      const raw = await llamaChat([
          { role: 'system', content: 'You are an experienced recruiter. Be concise and constructive.' },
          { role: 'user', content: `Evaluate the following answer to the question.\nTone: ${tone}\nQuestion: ${question}\nAnswer: ${answer}\nReturn STRICT JSON with keys: {"clarity":1-10,"confidence":1-10,"relevance":1-10,"feedback":"...","improved":"..."}` }
      ], { temperature: 0.3, response_format: { type: 'json_object' } });
      const parsed = JSON.parse(raw);
      const clarity = Math.max(1, Math.min(10, Number(parsed.clarity || 0)));
      const confidence = Math.max(1, Math.min(10, Number(parsed.confidence || 0)));
      const relevance = Math.max(1, Math.min(10, Number(parsed.relevance || 0)));
      res.json({ clarity, confidence, relevance, feedback: parsed.feedback || '', improved: parsed.improved || '' });
    } catch (e) {
      res.status(500).json({ error: e?.message || 'Failed to evaluate answer' });
    }
  });

  // Interview Coach: finish -> compute averages client-side or here; we do simple averaging
  app.post('/career/interview/finish', requireAuth, enforceWordLimit, async (req, res) => {
    try {
      const { feedbacks } = req.body ?? {};
      const arr = Array.isArray(feedbacks) ? feedbacks : [];
      if (arr.length === 0) return res.json({ scores: { clarity: 0, confidence: 0, relevance: 0 } });
      const sum = arr.reduce((acc, f) => ({
        clarity: acc.clarity + (Number(f.clarity) || 0),
        confidence: acc.confidence + (Number(f.confidence) || 0),
        relevance: acc.relevance + (Number(f.relevance) || 0),
      }), { clarity: 0, confidence: 0, relevance: 0 });
      const n = arr.length;
      const scores = { clarity: +(sum.clarity / n).toFixed(1), confidence: +(sum.confidence / n).toFixed(1), relevance: +(sum.relevance / n).toFixed(1) };
      res.json({ scores });
    } catch (e) {
      res.status(500).json({ error: e?.message || 'Failed to finish session' });
    }
  });

  // Career: Parse Resume Free Text -> { fullName?, contact?, sections:[{type,styleKey,html}] }
  app.post('/career/parse-resume', requireAuth, enforceWordLimit, aiLimiter, enforceDailyAILimit, async (req, res) => {
    try {
      const { text } = req.body ?? {};
      if (!text || typeof text !== 'string' || text.trim().length < 2) return res.status(400).json({ error: 'text required' });
      const raw = await llamaChat([
          { role: 'system', content: 'You classify free-form resume notes into structured data and minimal HTML blocks. Prefer structured arrays for Education, Experience, Skills, and Projects. Keep HTML concise (no colors).' },
          { role: 'user', content: `From the following text, identify resume details. Return STRICT JSON with these keys:\n{\n  "fullName": "string (optional)",\n  "contact": "string (optional)",\n  "education": [{"school":"string","start":"YYYY (optional)","end":"YYYY (optional)","degree":"string (optional)","honors":"string (optional)"}],\n  "experience": [{"role":"string","company":"string","start":"YYYY (optional)","end":"YYYY (optional)","bullets":["..."]}],\n  "skills": ["..."] ,\n  "projects": [{"name":"string","description":"string (optional)"}],\n  "sections": [{"type":"Summary|Experience|Education|Skills|Projects","styleKey":"summary_v1|exp_v1|edu_v1|skills_v1|proj_v1","html":"<h3>...</h3>..."}]\n}\nPopulate the arrays even if partial data is found (leave missing fields empty). Avoid dumping the raw input into sections; instead, structure it. Aim for 2-5 sections where helpful.\n\nText:\n${text}` }
      ], { temperature: 0.1, response_format: { type: 'json_object' } });
      let parsed;
      try { parsed = JSON.parse(raw); } catch { const m = raw.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }

      if (!parsed || typeof parsed !== 'object') {
        const rawText = String(text);
        const lines = rawText.split(/\n+/).map(s=>s.trim()).filter(Boolean);
        const parts = { edu: [], exp: [], skills: [], proj: [], other: [] };
        const skillLike = /\bskills?\b\s*:?/i;
        const eduLike = /(university|college|institute|academy|school|cal state|csu|csula|degree|bachelor|master|mba|phd)/i;
        const dateLike = /(19|20)\d{2}/;
        lines.forEach(l=>{
          if (skillLike.test(l)) parts.skills.push(l.replace(skillLike,'').trim());
          else if (eduLike.test(l)) parts.edu.push(l);
          else if (/project/i.test(l)) parts.proj.push(l);
          else if (/experience|worked|role|position|engineer|developer|manager/i.test(l) || dateLike.test(l)) parts.exp.push(l);
          else parts.other.push(l);
        });

        const eduEntries = [];
        const eduRegex = new RegExp(`(?:(?:at|from)\s+)?([A-Z][A-Za-z&\-\s\.]*?(?:University|College|Institute|Academy|School|Cal State(?:\s+[A-Z][A-Za-z]*)?|CSULA|UCLA|MIT|Harvard|Stanford|Berkeley|NYU|CMU|UC\s*[A-Z]+|[A-Z][A-Za-z]+\s+State\s+University))`+
          `(?:[^\d]{0,20}?((?:19|20)\d{2})\s*(?:[--to]{1,3}|to)\s*((?:19|20)\d{2}))?`+
          `[^\n]*?((?:B\.?S\.?|B\.?A\.?|M\.?S\.?|M\.?A\.?|MBA|PhD|Bachelor(?:'s)?|Master(?:'s)?)[^\n]{0,40})?`+
          `[^\n]*?((?:cum\s+laude|magna\s+cum\s+laude|summa\s+cum\s+laude|honou?rs|Dean'?s\s+List)[^\n]{0,40})?`, 'ig');
        let mm;
        while ((mm = eduRegex.exec(rawText)) !== null) {
          const school = (mm[1]||'').trim();
          const y1 = mm[2]||''; const y2 = mm[3]||'';
          const degree = (mm[4]||'').trim();
          const honors = (mm[5]||'').trim();
          if (school) eduEntries.push({ school, start:y1, end:y2, degree, honors });
        }

        const expEntries = [];
        const expRegex = new RegExp(`(?:as|role|position|worked\s+as)?\s*([A-Z][A-Za-z0-9&\-\s]{2,}?)(?:\s+-\s+|\s+at\s+)([A-Z][A-Za-z0-9&\-\s]{2,})`+
          `(?:[^\d]{0,20}?((?:19|20)\d{2})\s*(?:[--to]{1,3}|to)\s*((?:19|20)\d{2}))?`, 'ig');
        let me;
        while ((me = expRegex.exec(rawText)) !== null) {
          const role = (me[1]||'').trim();
          const company = (me[2]||'').trim();
          const start = me[3]||''; const end = me[4]||'';
          if (company || role) expEntries.push({ role, company, start, end, bullets: [] });
        }
        lines.forEach(l=>{
          if (/^[-•]/.test(l)) {
            const clean = l.replace(/^[-•]\s*/, '').trim();
            if (expEntries.length) expEntries[expEntries.length-1].bullets.push(clean);
          }
        });

        const skillsStruct = [];
        const skillsLine = lines.find(l=>/\bskills?\b\s*:|\btech\b|\bstack\b/i.test(l));
        if (skillsLine) {
          const rawSkills = skillsLine.replace(/^[^:]*:\s*/,'');
          rawSkills.split(/[,|\/]|\s{2,}/).map(s=>s.trim()).filter(Boolean).forEach(s=>skillsStruct.push(s));
        }

        const projectsStruct = [];
        lines.forEach(l=>{
          if (/project|built|created/i.test(l)) {
            const mproj = l.match(/^([A-Z][A-Za-z0-9\-\s]{2,})\s+-\s+(.+)/);
            if (mproj) projectsStruct.push({ name: mproj[1].trim(), description: mproj[2].trim() });
          }
        });

        const mk = (title, body) => `<h3 class="font-semibold text-[1.05em]">${title}</h3>${body}`;
        const items = [];
        if (parts.other.length) items.push({ type:'Summary', styleKey:'summary_v1', html: mk('Summary', `<p class="text-sm">${parts.other.join(' ')}</p>`) });
        if (parts.exp.length) items.push({ type:'Experience', styleKey:'exp_v1', html: mk('Experience', `<ul class="list-disc pl-5 text-sm">${parts.exp.slice(0,6).map(e=>`<li>${e}</li>`).join('')}</ul>`) });
        if (parts.skills.length) items.push({ type:'Skills', styleKey:'skills_v1', html: mk('Skills', `<p class="text-sm">${parts.skills.join(', ')}</p>`) });
        if (eduEntries.length) {
          const eduHtml = `<ul class="list-disc pl-5 text-sm">${eduEntries.map(e=>`<li>${e.school}${(e.start&&e.end)?` (${e.start}-${e.end})`:''}${e.degree?` - ${e.degree.replace(/\s+in\s*$/i,'')}`:''}${e.honors?` - ${e.honors}`:''}</li>`).join('')}</ul>`;
          items.push({ type:'Education', styleKey:'edu_v1', html: mk('Education', eduHtml) });
        } else if (parts.edu.length) {
          items.push({ type:'Education', styleKey:'edu_v1', html: mk('Education', `<ul class="list-disc pl-5 text-sm">${parts.edu.map(e=>`<li>${e}</li>`).join('')}</ul>`) });
        }
        if (parts.proj.length) items.push({ type:'Projects', styleKey:'proj_v1', html: mk('Projects', `<ul class="list-disc pl-5 text-sm">${parts.proj.map(e=>`<li>${e}</li>`).join('')}</ul>`) });
        if (items.length === 0) items.push({ type:'Summary', styleKey:'summary_v1', html: mk('Summary', `<p class="text-sm">${rawText}</p>`) });
        return res.json({ fullName: '', contact: '', sections: items.slice(0,8), education_struct: eduEntries, experience_struct: expEntries, skills_struct: skillsStruct, projects_struct: projectsStruct });
      }

      const sections = Array.isArray(parsed.sections) ? parsed.sections.slice(0,8) : [];
      let education_struct = [];
      let experience_struct = [];
      let skills_struct = [];
      let projects_struct = [];
      if (Array.isArray(parsed.education)) {
        education_struct = parsed.education.map(e => ({
          school: e.school || e.university || '',
          start: e.start || e.startYear || '',
          end: e.end || e.endYear || '',
          degree: e.degree || e.level || '',
          honors: e.honors || e.mentions || ''
        })).filter(x => x.school);
      }
      if (Array.isArray(parsed.experience)) {
        experience_struct = parsed.experience.map(e => ({
          role: e.role || e.title || '',
          company: e.company || e.org || '',
          start: e.start || e.startYear || '',
          end: e.end || e.endYear || '',
          bullets: Array.isArray(e.bullets) ? e.bullets : (e.description ? [e.description] : [])
        })).filter(x => x.role || x.company);
      }
      if (Array.isArray(parsed.skills)) skills_struct = parsed.skills.filter(Boolean);
      if (Array.isArray(parsed.projects)) projects_struct = parsed.projects.map(p=>({ name: p.name || '', description: p.description || '' })).filter(x=>x.name || x.description);
      return res.json({ fullName: parsed.fullName || '', contact: parsed.contact || '', sections, education_struct, experience_struct, skills_struct, projects_struct });
    } catch (e) {
      res.status(500).json({ error: e?.message || 'Failed to parse resume text' });
    }
  });

  // Career: Resume -> { resume }
  app.post('/career/resume', requireAuth, enforceWordLimit, aiLimiter, enforceDailyAILimit, async (req, res) => {
    try {
      const { fullName, contact, role, years, goals, experience, skills, education, tone } = req.body ?? {};
      const resume = await llamaChat([
          { role: 'system', content: 'You are a professional career consultant. Generate concise, ATS-friendly one-page resumes. Output clean Markdown only.' },
          { role: 'user', content: `Build a one-page resume in Markdown with sections: Summary, Experience, Skills, Education, Contact. Tone: ${tone || 'Professional'}.\nFull name: ${fullName || ''}\nContact: ${contact || ''}\nTarget role: ${role || ''}\nYears of experience: ${years || '0'}\nCareer goals: ${goals || ''}\nExperience bullets (one per line):\n${(experience || '')}\nSkills (comma-separated): ${skills || ''}\nEducation (one per line):\n${education || ''}\n\nConstraints:\n- Keep within one page.\n- Prefer impact bullets with metrics.\n- No arbitrary placeholders.\n` }
      ], { temperature: 0.4 });
      res.json({ resume });
    } catch (e) {
      res.status(500).json({ error: e?.message || 'Failed to generate resume' });
    }
  });
}
