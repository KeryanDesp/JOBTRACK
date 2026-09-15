import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DashboardPreview } from '../components/dashboard-preview';

export function HeroSection() {
  return (
    <section className="px-6 pt-20 pb-16 lg:pt-28">
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="max-w-3xl"
        >
          <h1 className="text-4xl font-semibold tracking-tight text-balance lg:text-6xl">
            Toutes vos opportunités.
            <br />
            <span className="text-muted-foreground">Un seul endroit.</span>
          </h1>

          <p className="text-muted-foreground mt-6 max-w-xl text-lg">
            JobTrack centralise vos recherches d'emploi, analyse les opportunités et vous aide à
            postuler plus intelligemment.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link to="/register">Commencer gratuitement</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#comment-ca-marche">Voir comment ça marche</a>
            </Button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
          className="mt-16"
        >
          <DashboardPreview />
        </motion.div>
      </div>
    </section>
  );
}
