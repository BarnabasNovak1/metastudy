import { useEffect } from "react";
import { loadGoogleTags } from "@/components/CookieConsent";

interface SEOProps {
  title: string;
  description?: string;
  keywords?: string[];
  canonical?: string;
  ogImage?: string;
  jsonLd?: any[]; // array of JSON-LD objects
}

export function SEO({ title, description, keywords, canonical, ogImage, jsonLd }: SEOProps) {
  useEffect(() => {
    if (title) document.title = title;

    const ensureMeta = (name: string, attr: "name" | "property" = "name") => {
      let m = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!m) {
        m = document.createElement("meta");
        m.setAttribute(attr, name);
        document.head.appendChild(m);
      }
      return m;
    };

    if (description) {
      const m = ensureMeta("description");
      m.setAttribute("content", description);
      const ogDesc = ensureMeta("og:description", "property");
      ogDesc.setAttribute("content", description);
      const twitterDesc = ensureMeta("twitter:description");
      twitterDesc.setAttribute("content", description);
    }

    if (keywords && keywords.length) {
      const m = ensureMeta("keywords");
      m.setAttribute("content", keywords.join(", "));
    }

    if (canonical) {
      let link = document.head.querySelector("link[rel=canonical]") as HTMLLinkElement | null;
      if (!link) { link = document.createElement("link"); link.setAttribute("rel", "canonical"); document.head.appendChild(link); }
      link.setAttribute("href", canonical);
    }

    const ogTitle = ensureMeta("og:title", "property");
    ogTitle.setAttribute("content", title);
    const ogType = ensureMeta("og:type", "property");
    ogType.setAttribute("content", "website");
    const ogSiteName = ensureMeta("og:site_name", "property");
    ogSiteName.setAttribute("content", "metastudy-e1ba2.web.app");
    const ogLocale = ensureMeta("og:locale", "property");
    ogLocale.setAttribute("content", "en_US");
    
    // Additional SEO meta tags
    const robots = ensureMeta("robots");
    robots.setAttribute("content", "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1");
    const googlebot = ensureMeta("googlebot");
    googlebot.setAttribute("content", "index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1");
    const bingbot = ensureMeta("bingbot");
    bingbot.setAttribute("content", "index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1");
    
    // Theme color for mobile browsers
    const themeColor = ensureMeta("theme-color");
    themeColor.setAttribute("content", "#000000");
    const msapplicationTileColor = ensureMeta("msapplication-TileColor");
    msapplicationTileColor.setAttribute("content", "#000000");
    
    // Author and publisher
    const author = ensureMeta("author");
    author.setAttribute("content", "metastudy-e1ba2.web.app");
    const publisher = ensureMeta("publisher");
    publisher.setAttribute("content", "metastudy-e1ba2.web.app");
    
    // Language
    const language = ensureMeta("language");
    language.setAttribute("content", "English");
    
    // Content type
    const contentType = ensureMeta("content-type");
    contentType.setAttribute("content", "text/html; charset=utf-8");

    const twitterCard = ensureMeta("twitter:card");
    twitterCard.setAttribute("content", "summary_large_image");
    const twitterTitle = ensureMeta("twitter:title");
    twitterTitle.setAttribute("content", title);
    const twitterSite = ensureMeta("twitter:site");
    twitterSite.setAttribute("content", "@metastudy_ai");
    const twitterCreator = ensureMeta("twitter:creator");
    twitterCreator.setAttribute("content", "@metastudy_ai");

    const fallbackImg = (typeof window !== 'undefined' ? window.location.origin : '') + "/metastudy-og.png";
    const chosenImg = ogImage || fallbackImg;
    if (chosenImg) {
      const ogImg = ensureMeta("og:image", "property");
      ogImg.setAttribute("content", chosenImg);
      const twitterImg = ensureMeta("twitter:image");
      twitterImg.setAttribute("content", chosenImg);
    }

    // Inject Google tags only if the user accepted cookies (no-op otherwise)
    loadGoogleTags();

    // JSON-LD scripts (replace existing from this component)
    const existing = Array.from(document.querySelectorAll('script[data-seo-jsonld="true"]'));
    existing.forEach((n) => n.parentElement?.removeChild(n));
    const scripts: HTMLScriptElement[] = [];
    if (jsonLd && jsonLd.length) {
      jsonLd.forEach((obj) => {
        const s = document.createElement("script");
        s.type = "application/ld+json";
        s.setAttribute("data-seo-jsonld", "true");
        s.text = JSON.stringify(obj);
        document.head.appendChild(s);
        scripts.push(s);
      });
    }
    return () => scripts.forEach((script) => script.remove());
  }, [title, description, JSON.stringify(keywords), canonical, ogImage, JSON.stringify(jsonLd)]);

  return null;
}
