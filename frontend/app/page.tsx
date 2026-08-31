'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import gsap from 'gsap';
import { SignInButton, SignOutButton, UserButton, useUser } from '@clerk/nextjs';
import Orchestrator from '../lib/ThreeJS/Orchestrator';
import './landing.css';

const AnimatedText = ({ text }: { text: string }) => {
  return (
    <>
      {text.split('').map((char, i) => (
        <span key={i} className={`char-span ${char.trim() ? 'anim-char' : ''}`} style={{ whiteSpace: 'pre' }}>
          {char}
        </span>
      ))}
    </>
  );
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isSignedIn, user } = useUser();
  const [timeStr, setTimeStr] = useState('');

  const emailText = user?.primaryEmailAddress?.emailAddress;
  const truncatedEmail = emailText ? emailText.slice(0, 5) + '...' : '';

  useEffect(() => {
    // 1. Initialize WebGL
    let orchestrator: Orchestrator | null = null;
    if (canvasRef.current) {
      orchestrator = new Orchestrator(canvasRef.current);
    }

    // 2. Initialize GSAP animations
    const animatedElements = [
        ".nav-logo a",
        ".nav-links a",
        ".nav-socials .auth-link",
        ".nav-socials .user-profile",
        ".nav-time p",
        ".hero-section h1",
        ".bar-location p",
        ".bar-projects a",
        ".bar-availability a",
    ];

    gsap.fromTo(
        animatedElements,
        { opacity: 0, y: 20 },
        { duration: 1, opacity: 1, y: 0, stagger: 0.1, ease: "power3.out", delay: 0.5 }
    );

    // 3. Time updater
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString("en-US", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: true }) + " HKT");
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);

    // 4. Random Text Flip Effect
    const flipInterval = setInterval(() => {
      const charSpans = document.querySelectorAll('.anim-char');
      if (charSpans.length === 0) return;
      
      const numFlips = Math.floor(Math.random() * 5) + 3; // 3 to 7 letters
      for (let i = 0; i < numFlips; i++) {
        const randomIndex = Math.floor(Math.random() * charSpans.length);
        const span = charSpans[randomIndex];
        span.classList.add('mirror-flip');
        setTimeout(() => span.classList.remove('mirror-flip'), 1000);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      clearInterval(flipInterval);
      if (orchestrator) orchestrator.destroy();
    };
  }, []);

  return (
    <>
      <div className="overlay">
          <div className="top-nav">
              <div className="nav-logo">
                  <a href="#">Nexus A2A</a>
              </div>
              <div className="nav-content">
                  <div className="nav-links">
                      <Link href="/shop" className="animated-link">
                          <span className="link-content">
                              <span className="link-text">Customer Shop</span>
                              <span className="link-text">Customer Shop</span>
                          </span>
                      </Link>
                      <Link href="/dashboard" className="animated-link">
                          <span className="link-content">
                              <span className="link-text">Merchant Dashboard</span>
                              <span className="link-text">Merchant Dashboard</span>
                          </span>
                      </Link>
                  </div>
                  <div className="nav-socials">
                    {isSignedIn ? (
                      <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255, 255, 255, 0.1)', padding: '6px 14px', borderRadius: '100px', border: '1px solid rgba(255, 255, 255, 0.15)', backdropFilter: 'blur(16px)', width: 'fit-content' }}>
                        <UserButton />
                        <span style={{ fontSize: '18px', color: 'var(--secondary-text-color)' }}>
                          {truncatedEmail}
                        </span>
                        <span style={{ color: 'var(--secondary-text-color)', margin: '0 4px', fontSize: '18px' }}>|</span>
                        <SignOutButton>
                          <div className="animated-link auth-link" style={{ cursor: 'pointer', color: 'var(--secondary-text-color)' }}>
                            <span className="link-content">
                              <span className="link-text">Sign Out</span>
                              <span className="link-text">Sign Out</span>
                            </span>
                          </div>
                        </SignOutButton>
                      </div>
                    ) : (
                      <SignInButton mode="modal">
                        <div className="animated-link auth-link" style={{ cursor: 'pointer', color: 'var(--secondary-text-color)' }}>
                          <span className="link-content">
                            <span className="link-text">Sign In</span>
                            <span className="link-text">Sign In</span>
                          </span>
                        </div>
                      </SignInButton>
                    )}
                  </div>
                  <div className="nav-time" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '2px' }}>
                      <p>{timeStr}</p>
                  </div>
              </div>
          </div>
          
          <div className="hero-section">
              <div className="spacer"></div>
              <h1>
                  <AnimatedText text="Nexus is an intelligent, dynamic pricing engine designed to seamlessly handle " />
                  <span className="secondary">
                      <AnimatedText text="B2C, B2B, and Agent-to-Agent (A2A) commerce. No static catalogs. No fixed prices. Just intelligent negotiation." />
                  </span>
              </h1>
              <div className="spacer-back"></div>
          </div>
          
          <div className="bottom-bar">
              <div className="bar-location">
                  <p>Based in Cyberspace</p>
              </div>
              <div className="bar-projects">
                  <Link href="/shop" className="animated-link">
                      <span className="link-content">
                          <span className="link-text">Customer Shop<img className="arrow-icon" src="/arrow.svg" alt="Arrow" /></span>
                          <span className="link-text">Customer Shop<img className="arrow-icon" src="/arrow.svg" alt="Arrow" /></span>
                      </span>
                  </Link>
              </div>
              <div className="bar-availability">
                  <Link href="/dashboard" className="animated-link">
                      <span className="link-content">
                          <span className="link-text">Merchant Dashboard<img className="arrow-icon" src="/arrow.svg" alt="Arrow" /></span>
                          <span className="link-text">Merchant Dashboard<img className="arrow-icon" src="/arrow.svg" alt="Arrow" /></span>
                      </span>
                  </Link>
              </div>
          </div>
      </div>
      <canvas ref={canvasRef} className="webgl"></canvas>
    </>
  );
}
