import { HomeContent } from '@/components/layout/home-content';
import { HomeActions } from '@/features/auth/home-actions';

export default function HomePage() {
  return (
    <>
      <section className="hero" aria-labelledby="home-heading">
        <div className="max-w-2xl">
          <h1 id="home-heading">Plan your next trip.</h1>
          <p className="hero-description">Set up your travel account and save your preferences.</p>
          <HomeActions />
        </div>
      </section>
      <HomeContent />
    </>
  );
}
