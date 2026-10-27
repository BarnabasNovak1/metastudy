import { useState, useEffect, useCallback } from "react";
import { 
  MessageSquare, FileText, Layers, ListChecks, BookOpen, FileCheck, Linkedin, Users, Compass, Brain,
  ChevronRight, Play, Pause, Upload, CheckCircle2, Clock,
  GraduationCap, Lightbulb, Target, Star, Trophy
} from "lucide-react";
import MetaStudyLogo from "@/assets/metastudy-icon.png";

interface FeatureDemo {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  duration: number; // ms
  color: string;
}

const features: FeatureDemo[] = [
  { id: "chat", title: "AI Study Chat", subtitle: "Ask anything, learn everything", icon: <MessageSquare className="w-5 h-5" />, duration: 8000, color: "bg-blue-500" },
  { id: "summarizer", title: "Smart Summarizer", subtitle: "Turn long readings into quick notes", icon: <FileText className="w-5 h-5" />, duration: 8000, color: "bg-purple-500" },
  { id: "flashcards", title: "AI Flashcards", subtitle: "Study smarter, not harder", icon: <Layers className="w-5 h-5" />, duration: 8000, color: "bg-orange-500" },
  { id: "quiz", title: "Quiz Generator", subtitle: "Test yourself before the real test", icon: <ListChecks className="w-5 h-5" />, duration: 8000, color: "bg-green-500" },
  { id: "lessons", title: "Lesson Generator", subtitle: "Learn any topic step by step", icon: <BookOpen className="w-5 h-5" />, duration: 13000, color: "bg-indigo-500" },
  { id: "resume", title: "Resume Builder", subtitle: "Get your resume reviewed by AI", icon: <FileCheck className="w-5 h-5" />, duration: 8000, color: "bg-rose-500" },
  { id: "linkedin", title: "LinkedIn Generator", subtitle: "Create posts that get noticed", icon: <Linkedin className="w-5 h-5" />, duration: 12000, color: "bg-sky-500" },
  { id: "interview", title: "Mock Interview", subtitle: "Practice makes perfect", icon: <Users className="w-5 h-5" />, duration: 8000, color: "bg-teal-500" },
  { id: "career", title: "Career Recommendations", subtitle: "Discover careers that fit you", icon: <Compass className="w-5 h-5" />, duration: 7000, color: "bg-fuchsia-500" },
  { id: "feed", title: "Study Feed", subtitle: "Share and discover study materials", icon: <Star className="w-5 h-5" />, duration: 11000, color: "bg-pink-500" },
];

// Chat Demo Component
const ChatDemo = ({ isActive }: { isActive: boolean }) => {
  const [messages, setMessages] = useState<{role: string; text: string; visible: boolean}[]>([]);
  const [typing, setTyping] = useState(false);
  
  useEffect(() => {
    if (!isActive) {
      setMessages([]);
      setTyping(false);
      return;
    }
    
    const sequence = [
      { delay: 400, role: "user", text: "Can you help me understand why the sky is blue?" },
      { delay: 1800, role: "typing", text: "" },
      { delay: 3200, role: "ai", text: "Great question! ☀️ When sunlight enters our atmosphere, it bumps into tiny gas molecules. Blue light has shorter waves, so it bounces around more than other colors, this is called 'scattering.' That's why we see blue everywhere we look up! It's like how a ball bounces more in a small room than a big one." },
    ];
    
    const timeouts: NodeJS.Timeout[] = [];
    sequence.forEach((msg) => {
      const t = setTimeout(() => {
        if (msg.role === "typing") {
          setTyping(true);
        } else {
          setTyping(false);
          setMessages(prev => [...prev, { role: msg.role, text: msg.text, visible: true }]);
        }
      }, msg.delay);
      timeouts.push(t);
    });
    
    return () => timeouts.forEach(t => clearTimeout(t));
  }, [isActive]);
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border/50">
        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-500 flex items-center justify-center">
          <Brain className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
        </div>
        <div>
          <div className="text-xs sm:text-sm font-medium">Study Chat</div>
          <div className="text-[10px] sm:text-xs text-green-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Online
          </div>
        </div>
      </div>
      
      <div className="space-y-2 sm:space-y-3 min-h-[140px] sm:min-h-[160px]">
        {messages.map((msg, i) => (
          <div 
            key={i} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-3 duration-400`}
          >
            <div className={`max-w-[90%] sm:max-w-[88%] rounded-2xl px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm leading-relaxed shadow-sm ${
              msg.role === 'user' 
                ? 'bg-blue-500 text-white rounded-br-sm' 
                : 'bg-muted/80 border border-border/50 rounded-bl-sm'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start animate-in fade-in duration-200">
            <div className="bg-muted/80 border border-border/50 rounded-2xl rounded-bl-sm px-3 sm:px-4 py-2 sm:py-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-muted-foreground/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}
        {messages.length === 0 && !typing && (
          <div className="flex items-center justify-center h-[100px] sm:h-[120px] text-muted-foreground text-xs sm:text-sm">
            <div className="text-center space-y-2">
              <MessageSquare className="w-6 h-6 sm:w-8 sm:h-8 mx-auto opacity-40" />
              <span>Ask me anything...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Summarizer Demo
const SummarizerDemo = ({ isActive }: { isActive: boolean }) => {
  const [stage, setStage] = useState(0);
  
  useEffect(() => {
    if (!isActive) { setStage(0); return; }
    const t1 = setTimeout(() => setStage(1), 800);
    const t2 = setTimeout(() => setStage(2), 2500);
    const t3 = setTimeout(() => setStage(3), 4500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isActive]);
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-border/50">
        <div className="w-10 h-10 rounded-xl bg-purple-500 flex items-center justify-center shadow-lg">
          <FileText className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold">Chapter 5: The American Revolution</div>
          <div className="text-xs text-muted-foreground">History Textbook • 12 pages</div>
        </div>
      </div>
      
      {/* Original text fading out */}
      <div className={`bg-muted/30 rounded-xl p-4 transition-all duration-700 ${stage >= 1 ? 'opacity-40 scale-[0.98]' : ''}`}>
        <div className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
          The American Revolution began in 1765 when colonists started resisting British authority. The Stamp Act of 1765 required colonists to pay taxes on printed materials. This led to protests with the famous cry "No taxation without representation." The Boston Tea Party in 1773 was a political protest where colonists dumped tea into Boston Harbor. The Declaration of Independence was signed on July 4, 1776...
        </div>
      </div>
      
      {/* Processing animation */}
      {stage >= 1 && stage < 3 && (
        <div className="flex items-center justify-center gap-3 py-2 animate-in fade-in duration-300">
          <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
            {stage === 1 ? "Reading content..." : "Creating summary..."}
          </span>
        </div>
      )}
      
      {/* Brief Summary Result */}
      {stage >= 3 && (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 animate-in fade-in slide-in-from-bottom-3 duration-500 shadow-lg">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-purple-500" />
            <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">Brief Summary</span>
          </div>
          <p className="text-sm leading-relaxed">
            The American Revolution (1765-1783) started when colonists refused to pay British taxes without having representatives in Parliament. Key events include the Boston Tea Party protest and signing of the Declaration of Independence on July 4, 1776.
          </p>
        </div>
      )}
    </div>
  );
};

// Flashcards Demo
const FlashcardsDemo = ({ isActive }: { isActive: boolean }) => {
  const [flipped, setFlipped] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [showHint, setShowHint] = useState(true);
  
  const cards = [
    { front: "What are the 3 states of matter?", back: "Solid, Liquid, and Gas! 🧊💧💨", subject: "Science" },
    { front: "What is 7 × 8?", back: "56", subject: "Math" },
  ];
  
  useEffect(() => {
    if (!isActive) { 
      setFlipped(false); 
      setCardIndex(0); 
      setShowHint(true); 
      return; 
    }
    // Card 1: Show → Flip → Next card
    const t0 = setTimeout(() => setShowHint(false), 800);
    const t1 = setTimeout(() => setFlipped(true), 1800);
    const t2 = setTimeout(() => { setFlipped(false); setCardIndex(1); }, 4000);
    // Card 2: Flip
    const t3 = setTimeout(() => setFlipped(true), 5500);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isActive]);
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center shadow-lg">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">{cards[cardIndex].subject} Flashcards</div>
            <div className="text-xs text-muted-foreground">
              Card {cardIndex + 1} of {cards.length}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          {cards.map((_, i) => (
            <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
              i === cardIndex ? 'bg-orange-500' : 'bg-muted'
            }`} />
          ))}
        </div>
      </div>
      
      {/* Card with 3D flip */}
      <div className="flex items-center justify-center">
        <div 
          className="w-full max-w-[340px] h-[180px] cursor-pointer"
          style={{ perspective: '1200px' }}
        >
          <div 
            className="relative w-full h-full transition-all duration-500 ease-out"
            style={{ 
              transformStyle: 'preserve-3d',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)'
            }}
          >
            {/* Front - Question */}
            <div 
              className="absolute inset-0 bg-orange-500 rounded-2xl p-6 flex flex-col items-center justify-center text-white text-center shadow-xl border border-orange-400/30"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div className="absolute top-3 left-3 px-2 py-1 bg-white/20 rounded-full text-xs font-medium">
                Question
              </div>
              <div className="text-lg font-semibold leading-relaxed px-2">{cards[cardIndex].front}</div>
              {showHint && (
                <div className="absolute bottom-4 text-xs opacity-80 animate-pulse flex items-center gap-1">
                  <span>Click to reveal answer</span>
                </div>
              )}
            </div>
            
            {/* Back - Answer */}
            <div 
              className="absolute inset-0 bg-amber-400 rounded-2xl p-6 flex flex-col items-center justify-center text-white text-center shadow-xl border border-amber-300/30"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="absolute top-3 left-3 px-2 py-1 bg-white/20 rounded-full text-xs font-medium">
                Answer
              </div>
              <div className="text-xl font-bold">{cards[cardIndex].back}</div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Navigation hint */}
      <div className="flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">←</kbd> Previous
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">Space</kbd> Flip
        </span>
        <span className="flex items-center gap-1">
          Next <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">→</kbd>
        </span>
      </div>
    </div>
  );
};

// Quiz Demo
const QuizDemo = ({ isActive }: { isActive: boolean }) => {
  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  
  useEffect(() => {
    if (!isActive) { setSelected(null); setShowResult(false); return; }
    const t1 = setTimeout(() => setSelected(1), 2500);
    const t2 = setTimeout(() => setShowResult(true), 4000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [isActive]);
  
  const options = [
    { text: "Mars", icon: "🔴" },
    { text: "Jupiter", icon: "🟠" },
    { text: "Saturn", icon: "🪐" },
    { text: "Neptune", icon: "🔵" }
  ];
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-green-500 flex items-center justify-center">
            <ListChecks className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">Science Quiz</div>
            <div className="text-xs text-muted-foreground">Question 3 of 10</div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>2:45</span>
        </div>
      </div>
      
      {/* Question */}
      <div className="bg-green-500/10 rounded-xl p-4 border border-green-500/20">
        <div className="text-base font-medium">
          Which planet is the largest in our solar system? 🌌
        </div>
      </div>
      
      {/* Options */}
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt, i) => (
          <div 
            key={i}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all duration-300 cursor-pointer ${
              selected === i 
                ? showResult 
                  ? i === 1 ? 'bg-green-500/20 border-green-500 shadow-lg shadow-green-500/20' : 'bg-red-500/20 border-red-500'
                  : 'bg-primary/10 border-primary shadow-lg'
                : showResult && i === 1 
                  ? 'bg-green-500/20 border-green-500'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
            }`}
          >
            <span className="text-lg">{opt.icon}</span>
            <span className={`text-sm font-medium ${
              showResult && i === 1 ? 'text-green-700 dark:text-green-400' : 
              showResult && selected === i && i !== 1 ? 'text-red-700 dark:text-red-400' : ''
            }`}>{opt.text}</span>
          </div>
        ))}
      </div>
      
      {/* Result feedback */}
      {showResult && (
        <div className="flex items-center gap-2 p-3 bg-green-500/10 rounded-xl animate-in fade-in slide-in-from-bottom-2 duration-300">
          <CheckCircle2 className="w-5 h-5 text-green-500" />
          <div>
            <span className="text-sm font-medium text-green-700 dark:text-green-400">Correct! </span>
            <span className="text-sm text-muted-foreground">Jupiter is 11x wider than Earth!</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Lessons Demo
const LessonsDemo = ({ isActive }: { isActive: boolean }) => {
  const [expandedSection, setExpandedSection] = useState<number | null>(null);
  
  useEffect(() => {
    if (!isActive) { setExpandedSection(null); return; }
    // Simple flow: expand section 0, then 1, then 2
    const t1 = setTimeout(() => setExpandedSection(0), 800);
    const t2 = setTimeout(() => setExpandedSection(1), 4500);
    const t3 = setTimeout(() => setExpandedSection(2), 8500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isActive]);
  
  const sections = [
    { title: "1. Introduction", icon: <BookOpen className="w-4 h-4" />, duration: "5 min" },
    { title: "2. Core Concepts", icon: <Brain className="w-4 h-4" />, duration: "15 min" },
    { title: "3. Examples", icon: <Lightbulb className="w-4 h-4" />, duration: "10 min" },
  ];
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/50">
        <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center shadow-lg">
          <GraduationCap className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">The Water Cycle 💧</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="px-1.5 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded">Grade 6-8</span>
            <span>•</span>
            <span>~30 min</span>
          </div>
        </div>
      </div>
      
      {/* Lesson sections */}
      <div className="space-y-2">
        {sections.map((section, i) => (
          <div 
            key={i}
            className={`rounded-xl border transition-all duration-500 overflow-hidden ${
              expandedSection === i 
                ? 'bg-indigo-500/5 border-indigo-500/30' 
                : 'border-border/50'
            }`}
          >
            <div className="flex items-center gap-3 p-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                expandedSection === i 
                  ? 'bg-indigo-500 text-white' 
                  : 'bg-muted text-muted-foreground'
              }`}>
                {section.icon}
              </div>
              <div className="flex-1">
                <div className={`text-sm font-medium ${expandedSection === i ? 'text-indigo-700 dark:text-indigo-300' : ''}`}>
                  {section.title}
                </div>
                <div className="text-xs text-muted-foreground">{section.duration}</div>
              </div>
              <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-300 ${expandedSection === i ? 'rotate-90' : ''}`} />
            </div>
            
            {/* Expanded content */}
            {expandedSection === i && (
              <div className="px-3 pb-3 animate-in fade-in duration-300">
                <div className="p-3 bg-background rounded-lg border border-border/50 text-xs leading-relaxed">
                  {i === 0 ? (
                    <div className="text-muted-foreground">
                      The water cycle describes the continuous movement of water on Earth. It includes evaporation, condensation, and precipitation...
                    </div>
                  ) : i === 1 ? (
                    <ul className="space-y-1 text-muted-foreground">
                      <li>• <strong>Evaporation:</strong> Water → Vapor</li>
                      <li>• <strong>Condensation:</strong> Vapor → Clouds</li>
                      <li>• <strong>Precipitation:</strong> Rain/Snow</li>
                    </ul>
                  ) : (
                    <div className="text-muted-foreground">
                      🌊 Ocean evaporation → ☁️ Cloud formation → 🌧️ Rainfall
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// Feed Demo - Study Feed with quiz flow and click animations
const FeedDemo = ({ isActive }: { isActive: boolean }) => {
  const [stage, setStage] = useState(0);
  const [answerClicked, setAnswerClicked] = useState(false);
  const [leaderboardClicked, setLeaderboardClicked] = useState(false);
  // Stages: 0=init, 1=feed post, 2=loading, 3=q1 (show options), 3.5=q1 answered, 4=q2, 4.5=q2 answered, 5=q3, 5.5=q3 answered, 6=results, 7=leaderboard
  
  useEffect(() => {
    if (!isActive) { setStage(0); setAnswerClicked(false); setLeaderboardClicked(false); return; }
    const timers = [
      setTimeout(() => setStage(1), 400),     // Feed post
      setTimeout(() => setStage(2), 2000),    // Loading
      setTimeout(() => setStage(3), 2800),    // Q1 options
      setTimeout(() => setAnswerClicked(true), 3400),  // Click answer
      setTimeout(() => { setAnswerClicked(false); setStage(3.5); }, 3700),  // Show result
      setTimeout(() => setStage(4), 4400),    // Q2 options
      setTimeout(() => setAnswerClicked(true), 5000),
      setTimeout(() => { setAnswerClicked(false); setStage(4.5); }, 5300),
      setTimeout(() => setStage(5), 6000),    // Q3 options
      setTimeout(() => setAnswerClicked(true), 6600),
      setTimeout(() => { setAnswerClicked(false); setStage(5.5); }, 6900),
      setTimeout(() => setStage(6), 7600),    // Results
      setTimeout(() => setLeaderboardClicked(true), 8600),  // Click leaderboard
      setTimeout(() => { setLeaderboardClicked(false); setStage(7); }, 8400),  // Show leaderboard
    ];
    return () => timers.forEach(clearTimeout);
  }, [isActive]);
  
  const questions = [
    { q: "What divides a cell into two identical cells?", selected: 1, correct: 1, options: ['Meiosis', 'Mitosis', 'Osmosis'] },
    { q: "DNA replication occurs in which phase?", selected: 0, correct: 0, options: ['S phase', 'G1 phase', 'M phase'] },
    { q: "Meiosis produces how many cells?", selected: 1, correct: 2, options: ['2 cells', '3 cells', '4 cells'] },
  ];
  
  const leaderboard = [
    { name: "Sarah M.", score: 100, avatar: "SM" },
    { name: "You", score: 66, avatar: "You", isUser: true },
    { name: "Alex K.", score: 33, avatar: "AK" },
  ];

  // Get current question index based on stage
  const getQIndex = () => {
    if (stage >= 3 && stage < 4) return 0;
    if (stage >= 4 && stage < 5) return 1;
    if (stage >= 5 && stage < 6) return 2;
    return -1;
  };
  const qIndex = getQIndex();
  const showResult = stage === 3.5 || stage === 4.5 || stage === 5.5;
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pink-500 flex items-center justify-center shadow-lg">
            <Star className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">Study Feed</div>
            <div className="text-xs text-muted-foreground">Discover & join challenges</div>
          </div>
        </div>
      </div>
      
      {/* Feed Post Card - stage 1 */}
      {stage === 1 && (
        <div className="p-4 rounded-xl border border-border bg-card animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">MT</div>
            <div className="flex-1">
              <span className="text-sm font-semibold">@marcus_t</span>
              <span className="text-xs text-muted-foreground ml-2">• 2h ago</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500 text-white">Quiz</span>
          </div>
          <div className="text-sm font-semibold mb-1">Biology: Cell Division</div>
          <div className="text-xs text-muted-foreground mb-3">3 questions • mitosis, meiosis</div>
          
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-primary text-primary-foreground">
                <Trophy className="w-3 h-3" /> Join Challenge
              </button>
              <button className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 border border-border">
                <Trophy className="w-3 h-3" /> Leaderboard
              </button>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <span>❤️ 24</span>
              <span>💬 8</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Loading - stage 2 */}
      {stage === 2 && (
        <div className="p-4 rounded-xl border border-border bg-card animate-in fade-in duration-300">
          <div className="flex items-center justify-center gap-3 py-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Opening challenge...</span>
          </div>
        </div>
      )}
      
      {/* Quiz Questions - stages 3-5.5 */}
      {qIndex >= 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden animate-in fade-in duration-300">
          <div className="p-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <span className="text-xs font-medium">Question {qIndex + 1} of 3</span>
            <span className="text-xs text-muted-foreground">Biology Quiz</span>
          </div>
          <div className="p-4 space-y-3">
            <div className="text-sm font-medium">{questions[qIndex].q}</div>
            <div className="space-y-2">
              {questions[qIndex].options.map((opt, i) => {
                const isSelected = i === questions[qIndex].selected;
                const isCorrect = i === questions[qIndex].correct;
                const isClicking = answerClicked && isSelected;
                return (
                  <div key={i} className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-all duration-150 ${
                    showResult && isSelected && isCorrect ? 'border-green-500 bg-green-500/10 text-green-700 dark:text-green-400' :
                    showResult && isSelected && !isCorrect ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400' :
                    isClicking ? 'border-primary bg-primary/10 scale-95' :
                    'border-border'
                  }`}>
                    <span>{opt}</span>
                    {showResult && isSelected && isCorrect && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    {showResult && isSelected && !isCorrect && <span className="text-red-500 font-bold">✗</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      
      {/* Results - stage 6 */}
      {stage === 6 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden animate-in fade-in zoom-in-95 duration-300">
          <div className="p-4 text-center space-y-3">
            <div className="text-4xl font-bold text-amber-500">66%</div>
            <div className="text-sm font-medium">You got 2 out of 3 correct!</div>
            <div className="flex justify-center gap-2">
              <span className="px-2 py-1 bg-green-500/20 text-green-700 dark:text-green-400 rounded text-xs">✓ 2 correct</span>
              <span className="px-2 py-1 bg-red-500/20 text-red-700 dark:text-red-400 rounded text-xs">✗ 1 wrong</span>
            </div>
            <button className={`px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center gap-2 mx-auto transition-all duration-150 ${
              leaderboardClicked ? 'scale-95 bg-primary/80' : ''
            }`}>
              <Trophy className="w-4 h-4" /> View Leaderboard
            </button>
          </div>
        </div>
      )}
      
      {/* Leaderboard - stage 7 */}
      {stage === 7 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-semibold">Leaderboard</span>
          </div>
          <div className="p-3 space-y-2">
            {leaderboard.map((entry, i) => (
              <div 
                key={i} 
                className={`flex items-center gap-3 p-2.5 rounded-lg ${
                  entry.isUser ? 'bg-primary/10 border border-primary/30' : 'bg-muted/30'
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-amber-400 text-amber-900' : 'bg-muted text-muted-foreground'}`}>
                  {i === 0 ? '🥇' : i + 1}
                </div>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${entry.isUser ? 'bg-primary' : 'bg-gray-400'}`}>
                  {entry.avatar}
                </div>
                <div className="flex-1 text-sm font-medium">{entry.name}</div>
                <div className={`text-sm font-bold ${entry.score === 100 ? 'text-green-600' : entry.score === 66 ? 'text-amber-500' : 'text-red-500'}`}>
                  {entry.score}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Resume Demo
const ResumeDemo = ({ isActive }: { isActive: boolean }) => {
  const [stage, setStage] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  
  useEffect(() => {
    if (!isActive) { setStage(0); setAnalyzing(false); return; }
    const t1 = setTimeout(() => setStage(1), 800);
    const t2 = setTimeout(() => { setStage(2); setAnalyzing(true); }, 2000);
    const t3 = setTimeout(() => { setStage(3); setAnalyzing(false); }, 4500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isActive]);
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/50">
        <div className="w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center shadow-lg">
          <FileCheck className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold">Resume Review</div>
          <div className="text-xs text-muted-foreground">AI-powered feedback</div>
        </div>
      </div>
      
      {/* Upload stage */}
      {stage === 0 && (
        <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
          <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <div className="text-sm text-muted-foreground">Drop your resume here</div>
        </div>
      )}
      
      {/* File uploaded */}
      {stage >= 1 && (
        <div className="bg-muted/30 rounded-xl p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-12 bg-rose-500/20 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-rose-500" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">my_resume.pdf</div>
              <div className="text-xs text-muted-foreground">Uploaded just now</div>
            </div>
            {stage < 3 && <CheckCircle2 className="w-5 h-5 text-green-500" />}
          </div>
        </div>
      )}
      
      {/* Analyzing animation */}
      {analyzing && (
        <div className="flex items-center justify-center gap-3 py-4 animate-in fade-in duration-300">
          <div className="w-5 h-5 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
            Analyzing your resume...
          </span>
        </div>
      )}
      
      {/* Feedback results */}
      {stage >= 3 && (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-500">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI Feedback</div>
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-3 bg-green-500/10 rounded-xl border border-green-500/20">
              <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-green-700 dark:text-green-400">Strong education section</span>
                <span className="text-muted-foreground">. GPA and coursework clearly listed</span>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
              <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-amber-700 dark:text-amber-400">Add more details</span>
                <span className="text-muted-foreground">. Describe your club activities with specific achievements</span>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <Target className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-blue-700 dark:text-blue-400">Tip</span>
                <span className="text-muted-foreground">. Include volunteer work and summer programs</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// LinkedIn Demo - accurate to Career Launchpad LinkedIn Generator with click animations
const LinkedInDemo = ({ isActive }: { isActive: boolean }) => {
  const [stage, setStage] = useState(0);
  const [typedTopic, setTypedTopic] = useState("");
  const [generatedText, setGeneratedText] = useState("");
  const [toneOpen, setToneOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [toneSelected, setToneSelected] = useState(false);
  const [typeSelected, setTypeSelected] = useState(false);
  // Stages: 0=init, 1=form, 2=typing, 3=open tone, 4=click tone, 5=open type, 6=click type, 7=click generate, 8=generating, 9=result
  
  const topicText = "Built a full-stack app using Next.js";
  const fullPost = "🚀 Excited to share my latest project!\n\nI just built a full-stack application using Next.js, and the learning experience was incredible.\n\nKey takeaways:\n✨ React Server Components are a game-changer\n✨ TypeScript catches bugs before they happen\n✨ Tailwind makes styling so much faster\n\nAlways learning, always growing! #WebDev #NextJS #Coding";
  
  const tones = ['Professional', 'Casual', 'Inspirational'];
  const postTypes = ['Project Update', 'Achievement', 'Learning'];
  
  useEffect(() => {
    if (!isActive) { 
      setStage(0); setTypedTopic(""); setGeneratedText(""); 
      setToneOpen(false); setTypeOpen(false); setToneSelected(false); setTypeSelected(false);
      return; 
    }
    const timers = [
      setTimeout(() => setStage(1), 400),
      setTimeout(() => setStage(2), 1000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isActive]);
  
  // Type topic
  useEffect(() => {
    if (stage !== 2 || !isActive) return;
    let i = 0;
    const interval = setInterval(() => {
      if (i <= topicText.length) {
        setTypedTopic(topicText.slice(0, i));
        i++;
      } else {
        clearInterval(interval);
        // After typing, open tone dropdown
        setTimeout(() => setStage(3), 400);
        setTimeout(() => setToneOpen(true), 400);
        setTimeout(() => setStage(4), 1200);  // Click tone option
        setTimeout(() => { setToneOpen(false); setToneSelected(true); setStage(5); }, 1500);
        setTimeout(() => setTypeOpen(true), 1800);  // Open type dropdown
        setTimeout(() => setStage(6), 2600);  // Click type option
        setTimeout(() => { setTypeOpen(false); setTypeSelected(true); setStage(7); }, 2900);
        setTimeout(() => setStage(8), 3500);  // Generating
        setTimeout(() => setStage(9), 4700);  // Show result
      }
    }, 30);
    return () => clearInterval(interval);
  }, [stage, isActive]);
  
  // Type generated post
  useEffect(() => {
    if (stage !== 9 || !isActive) return;
    let i = 0;
    const interval = setInterval(() => {
      if (i <= fullPost.length) {
        setGeneratedText(fullPost.slice(0, i));
        i++;
      } else {
        clearInterval(interval);
      }
    }, 10);
    return () => clearInterval(interval);
  }, [stage, isActive]);
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/50">
        <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center shadow-lg">
          <Linkedin className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold">AI LinkedIn Post Writer</div>
          <div className="text-xs text-muted-foreground">Create professional posts</div>
        </div>
      </div>
      
      {/* Form - stages 1-8 */}
      {stage >= 1 && stage <= 8 && (
        <div className="space-y-3 animate-in fade-in duration-300">
          {/* Topic input */}
          <div className="space-y-1">
            <div className="text-xs font-medium">Topic / Achievement</div>
            <div className="bg-muted/30 rounded-lg px-3 py-2 border border-border/50 text-sm min-h-[36px]">
              {typedTopic}
              {stage === 2 && <span className="animate-pulse text-sky-500">|</span>}
            </div>
          </div>
          
          {/* Tone & Post Type row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Tone dropdown */}
            <div className="space-y-1 relative">
              <div className="text-xs font-medium">Tone</div>
              <div className={`bg-muted/30 rounded-lg px-3 py-2 border text-xs cursor-pointer transition-all ${
                toneSelected ? 'border-sky-500 bg-sky-500/10' : 'border-border/50'
              }`}>
                {toneSelected ? 'Professional' : 'Select...'}
              </div>
              {/* Dropdown options */}
              {toneOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 animate-in fade-in slide-in-from-top-2 duration-200">
                  {tones.map((tone, i) => (
                    <div 
                      key={i}
                      className={`px-3 py-2 text-xs cursor-pointer transition-all ${
                        i === 0 && stage === 4 ? 'bg-sky-500/20 scale-95' : 'hover:bg-muted'
                      } ${i === 0 ? 'rounded-t-lg' : ''} ${i === tones.length - 1 ? 'rounded-b-lg' : ''}`}
                    >
                      {tone}
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Post Type dropdown */}
            <div className="space-y-1 relative">
              <div className="text-xs font-medium">Post Type</div>
              <div className={`bg-muted/30 rounded-lg px-3 py-2 border text-xs cursor-pointer transition-all ${
                typeSelected ? 'border-sky-500 bg-sky-500/10' : 'border-border/50'
              }`}>
                {typeSelected ? 'Project Update' : 'Select...'}
              </div>
              {/* Dropdown options */}
              {typeOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-10 animate-in fade-in slide-in-from-top-2 duration-200">
                  {postTypes.map((type, i) => (
                    <div 
                      key={i}
                      className={`px-3 py-2 text-xs cursor-pointer transition-all ${
                        i === 0 && stage === 6 ? 'bg-sky-500/20 scale-95' : 'hover:bg-muted'
                      } ${i === 0 ? 'rounded-t-lg' : ''} ${i === postTypes.length - 1 ? 'rounded-b-lg' : ''}`}
                    >
                      {type}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          
          {/* Generate button */}
          <button className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all ${
            stage >= 7 ? 'bg-sky-500 text-white' : 'bg-muted text-muted-foreground'
          } ${stage === 7 ? 'scale-95' : ''}`}>
            {stage === 8 ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating...
              </span>
            ) : (
              'Generate LinkedIn Post'
            )}
          </button>
        </div>
      )}
      
      {/* Generated post - stage 9 */}
      {stage === 9 && (
        <div className="space-y-3 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="text-xs font-medium text-muted-foreground">Generated Post:</div>
          <div className="bg-muted/30 rounded-xl p-3 border border-border/50">
            <div className="text-xs leading-relaxed whitespace-pre-line">
              {generatedText}
              {generatedText.length < fullPost.length && <span className="animate-pulse text-sky-500">|</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="flex-1 px-3 py-2 bg-sky-500 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Copy Post
            </button>
            <button className="px-3 py-2 bg-muted rounded-lg text-xs font-medium">Save</button>
            <button className="px-3 py-2 bg-muted rounded-lg text-xs font-medium">Regenerate</button>
          </div>
        </div>
      )}
    </div>
  );
};

// Interview Demo
const InterviewDemo = ({ isActive }: { isActive: boolean }) => {
  const [stage, setStage] = useState(0);
  
  useEffect(() => {
    if (!isActive) { setStage(0); return; }
    const t1 = setTimeout(() => setStage(1), 1000);
    const t2 = setTimeout(() => setStage(2), 3500);
    const t3 = setTimeout(() => setStage(3), 5500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isActive]);
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center shadow-lg">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold">Mock Interview</div>
            <div className="text-xs text-muted-foreground">College Admissions Practice</div>
          </div>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded-full">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
          <span className="text-xs text-red-600 dark:text-red-400 font-medium">Recording</span>
        </div>
      </div>
      
      {/* Interview question */}
      {stage >= 1 && (
        <div className="bg-teal-500/10 rounded-xl p-4 border border-teal-500/20 animate-in fade-in slide-in-from-left duration-300">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
              AI
            </div>
            <div>
              <div className="text-xs text-teal-600 dark:text-teal-400 font-medium mb-1">Interviewer</div>
              <div className="text-sm">"Tell me about a time you faced a challenge and how you overcame it."</div>
            </div>
          </div>
        </div>
      )}
      
      {/* User response hint */}
      {stage >= 2 && stage < 3 && (
        <div className="flex items-center justify-center gap-2 py-3 animate-in fade-in duration-300">
          <div className="w-3 h-3 rounded-full bg-teal-500 animate-pulse"></div>
          <span className="text-sm text-muted-foreground">Your turn to respond...</span>
        </div>
      )}
      
      {/* AI Feedback */}
      {stage >= 3 && (
        <div className="bg-emerald-500/10 rounded-xl p-4 border border-emerald-500/20 animate-in fade-in slide-in-from-bottom-3 duration-500">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">AI Coaching Feedback</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <span className="text-sm">Good eye contact and confident tone!</span>
            </div>
            <div className="flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <span className="text-sm">Try the STAR method: <span className="font-medium">S</span>ituation → <span className="font-medium">T</span>ask → <span className="font-medium">A</span>ction → <span className="font-medium">R</span>esult</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Career Demo - with resume upload flow
const CareerDemo = ({ isActive }: { isActive: boolean }) => {
  const [stage, setStage] = useState(0);
  // Stages: 0=init, 1=upload area, 2=uploading, 3=analyzing, 4=show skills, 5=show careers
  
  useEffect(() => {
    if (!isActive) { setStage(0); return; }
    const t1 = setTimeout(() => setStage(1), 400);   // Show upload area
    const t2 = setTimeout(() => setStage(2), 1500);  // Start uploading
    const t3 = setTimeout(() => setStage(3), 2200);  // Analyzing
    const t4 = setTimeout(() => setStage(4), 3200);  // Show extracted skills
    const t5 = setTimeout(() => setStage(5), 4500);  // Show career recs
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
  }, [isActive]);
  
  const careers = [
    { title: "Marine Biologist", icon: "🐋", desc: "Study ocean ecosystems" },
    { title: "Environmental Engineer", icon: "🌱", desc: "Solve environmental challenges" },
    { title: "Science Teacher", icon: "🔬", desc: "Inspire future scientists" },
  ];
  
  return (
    <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-border/50">
        <div className="w-10 h-10 rounded-xl bg-fuchsia-500 flex items-center justify-center shadow-lg">
          <Compass className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold">Career Recommendations</div>
          <div className="text-xs text-muted-foreground">Upload resume to find matching careers</div>
        </div>
      </div>
      
      {/* Upload area - stage 1 */}
      {stage === 1 && (
        <div className="border-2 border-dashed border-fuchsia-500/30 rounded-xl p-6 text-center bg-fuchsia-500/5 animate-in fade-in duration-300">
          <Upload className="w-8 h-8 mx-auto mb-2 text-fuchsia-500" />
          <div className="text-sm font-medium">Drop your resume here</div>
          <div className="text-xs text-muted-foreground">PDF, DOCX supported</div>
        </div>
      )}
      
      {/* Uploading - stage 2 */}
      {stage === 2 && (
        <div className="border rounded-xl p-4 bg-card animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-fuchsia-500/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-fuchsia-500" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">resume_2024.pdf</div>
              <div className="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                <div className="h-full bg-fuchsia-500 rounded-full animate-pulse" style={{ width: '60%' }} />
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Analyzing - stage 3 */}
      {stage === 3 && (
        <div className="text-center py-4 animate-in fade-in duration-300">
          <div className="w-8 h-8 border-3 border-fuchsia-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <div className="text-sm font-medium mt-2">Analyzing your resume...</div>
        </div>
      )}
      
      {/* Skills extracted - stage 4+ */}
      {stage >= 4 && (
        <div className="bg-muted/30 rounded-xl p-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-green-500" /> Skills identified:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['Science Club', 'Math Tutor', 'Lab Research', 'Volunteer'].map((skill, i) => (
              <span key={i} className="px-2 py-0.5 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400 rounded text-xs">{skill}</span>
            ))}
          </div>
        </div>
      )}
      
      {/* Career recommendations - stage 5 */}
      {stage >= 5 && (
        <div className="space-y-2 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <div className="text-xs font-medium text-muted-foreground">Best Career Matches:</div>
          {careers.map((career, i) => (
            <div 
              key={i}
              className="flex items-center gap-3 p-2.5 rounded-xl border border-border/50 bg-card animate-in fade-in slide-in-from-right"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="w-9 h-9 rounded-lg bg-fuchsia-500 flex items-center justify-center text-lg">
                {career.icon}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">{career.title}</div>
                <div className="text-xs text-muted-foreground">{career.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Main Component
export const AnimatedHeroDemo = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  
  const currentFeature = features[activeIndex];
  
  // Auto-advance through features
  useEffect(() => {
    if (isPaused) return;
    
    const duration = currentFeature.duration;
    const interval = 50;
    let elapsed = 0;
    
    const timer = setInterval(() => {
      elapsed += interval;
      setProgress((elapsed / duration) * 100);
      
      if (elapsed >= duration) {
        setActiveIndex((prev) => (prev + 1) % features.length);
        setProgress(0);
      }
    }, interval);
    
    return () => clearInterval(timer);
  }, [activeIndex, isPaused, currentFeature.duration]);
  
  const goToFeature = useCallback((index: number) => {
    setActiveIndex(index);
    setProgress(0);
  }, []);
  
  const renderDemo = () => {
    const isActive = !isPaused;
    switch (currentFeature.id) {
      case "chat": return <ChatDemo isActive={isActive} />;
      case "summarizer": return <SummarizerDemo isActive={isActive} />;
      case "flashcards": return <FlashcardsDemo isActive={isActive} />;
      case "quiz": return <QuizDemo isActive={isActive} />;
      case "lessons": return <LessonsDemo isActive={isActive} />;
      case "feed": return <FeedDemo isActive={isActive} />;
      case "resume": return <ResumeDemo isActive={isActive} />;
      case "linkedin": return <LinkedInDemo isActive={isActive} />;
      case "interview": return <InterviewDemo isActive={isActive} />;
      case "career": return <CareerDemo isActive={isActive} />;
      default: return null;
    }
  };
  
  return (
    <div className="w-full max-w-4xl mx-auto px-2 sm:px-0">
      {/* Main Demo Container */}
      <div className="relative bg-card border border-border rounded-2xl sm:rounded-3xl shadow-2xl overflow-visible">
        {/* MetaStudy logo peeking from top-right */}
        <img
          src={MetaStudyLogo}
          alt="MetaStudy"
          className="absolute -top-8 -right-4 sm:-top-12 sm:-right-6 w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 rounded-2xl z-20 pointer-events-none shadow-[var(--shadow-glow)] animate-in fade-in zoom-in duration-700"
          style={{ animationDelay: '500ms' }}
        />
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex gap-1 sm:gap-1.5">
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-red-500" />
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-yellow-500" />
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-green-500" />
            </div>
            <div className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full ${currentFeature.color} text-white text-[10px] sm:text-xs font-medium`}>
              <span className="[&>svg]:w-3 [&>svg]:h-3 sm:[&>svg]:w-5 sm:[&>svg]:h-5">{currentFeature.icon}</span>
              <span className="truncate max-w-[100px] sm:max-w-none">{currentFeature.title}</span>
            </div>
          </div>
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="p-1 sm:p-1.5 rounded-full hover:bg-muted transition-colors"
          >
            {isPaused ? <Play className="w-3 h-3 sm:w-4 sm:h-4" /> : <Pause className="w-3 h-3 sm:w-4 sm:h-4" />}
          </button>
        </div>
        
        {/* Demo Content */}
        <div className="min-h-[280px] sm:min-h-[340px] relative overflow-hidden">
          <div 
            key={currentFeature.id}
            className="animate-in fade-in duration-500"
          >
            {renderDemo()}
          </div>
        </div>
        
        {/* Progress Bar */}
        <div className="h-1 bg-muted">
          <div 
            className={`h-full ${currentFeature.color} transition-all duration-50`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      
      {/* Feature Navigation Pills */}
      <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 mt-4 sm:mt-6 px-2">
        {features.map((feature, i) => (
          <button
            key={feature.id}
            onClick={() => goToFeature(i)}
            className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-medium transition-all duration-300 ${
              i === activeIndex 
                ? `${feature.color} text-white shadow-lg scale-105` 
                : 'bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="[&>svg]:w-3 [&>svg]:h-3 sm:[&>svg]:w-5 sm:[&>svg]:h-5">{feature.icon}</span>
            <span className="hidden sm:inline">{feature.title}</span>
          </button>
        ))}
      </div>
      
      {/* Subtitle */}
      <div className="text-center mt-3 sm:mt-4 px-4">
        <p className="text-xs sm:text-sm text-muted-foreground animate-in fade-in duration-300" key={currentFeature.id}>
          {currentFeature.subtitle}
        </p>
      </div>
    </div>
  );
};
