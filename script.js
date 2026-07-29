// --- Instagram story tile -------------------------------------------------
// window.STORY comes from story-data.js. Video stories get a play/pause button;
// photo stories have nothing to play, so the button stays hidden.
const story = window.STORY;
const storyVideo = document.querySelector('#story-video');
const storyImage = document.querySelector('#story-image');
const playButton = document.querySelector('#story-play');

const PLAY_ICON = 'M8 5v14l11-7z';
const PAUSE_ICON = 'M6 5h4v14H6zM14 5h4v14h-4z';

if (story && storyVideo && playButton && storyImage) {
  const tile = document.querySelector('#intro-story');
  const link = document.querySelector('.story-link');
  if (link && story.permalink) link.href = story.permalink;
  

  // Match the tile to the story's real dimensions so object-fit never crops it.
  if (tile && story.width && story.height) {
    tile.style.setProperty('--story-ratio', `${story.width} / ${story.height}`);
  }

  if (story.hasStory && story.mediaType === 'VIDEO') {
    playButton.hidden = false;
    const audioButton = document.querySelector('#story-audio');
    const audioWrap = document.querySelector('#story-audio-wrap');
    const volume = document.querySelector('#story-volume');
    const progress = document.querySelector('#story-progress');

    const setIcon = (playing) => {
      playButton.querySelector('path').setAttribute('d', playing ? PAUSE_ICON : PLAY_ICON);
      playButton.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    };

    const setAudioIcon = () => {
      if (!audioButton) return;
      audioButton.classList.toggle('is-muted', storyVideo.muted);
      audioButton.setAttribute('aria-label', storyVideo.muted ? 'Включить звук' : 'Выключить звук');
    };

    playButton.addEventListener('click', () => {
      if (storyVideo.paused) {
        // Swap to the video only on first play, so the poster loads instantly.
        storyVideo.hidden = false;
        storyImage.hidden = true;
        if (audioWrap) audioWrap.hidden = false;
        if (progress) progress.hidden = false;

        // The click is a user gesture, so sound is normally allowed. If a browser
        // refuses anyway, retry muted rather than leaving the reel stuck.
        const started = storyVideo.play();
        if (started && typeof started.catch === 'function') {
          started.catch(() => {
            storyVideo.muted = true;
            setAudioIcon();
            storyVideo.play();
          });
        }
      } else {
        storyVideo.pause();
      }
    });

    if (audioButton) {
      audioButton.addEventListener('click', () => {
        storyVideo.muted = !storyVideo.muted;
        setAudioIcon();
      });
      storyVideo.addEventListener('volumechange', setAudioIcon);
    }

    if (volume) {
      volume.addEventListener('input', () => {
        storyVideo.volume = Number(volume.value);
        // Dragging to zero is a mute, and dragging back up should undo it.
        storyVideo.muted = storyVideo.volume === 0;
        setAudioIcon();
      });
    }

    if (progress) {
      const setProgress = (percent) => {
        progress.value = String(percent);
        progress.style.setProperty('--progress', `${percent}%`);
      };

      storyVideo.addEventListener('timeupdate', () => {
        if (!storyVideo.duration) return;
        setProgress((storyVideo.currentTime / storyVideo.duration) * 100);
      });

      progress.addEventListener('input', () => {
        if (!storyVideo.duration) return;
        const percent = Number(progress.value);
        storyVideo.currentTime = (percent / 100) * storyVideo.duration;
        setProgress(percent);
      });
    }

    // While playing, the controls are hidden and any pointer activity brings them
    // back for a moment. A CSS :hover rule cannot do this: the pointer is already on
    // the tile when play is clicked, so the controls would never fade at all.
    let hideControlsTimer;

    const revealControls = () => {
      clearTimeout(hideControlsTimer);
      tile.classList.add('show-controls');
      if (!storyVideo.paused) {
        hideControlsTimer = setTimeout(() => tile.classList.remove('show-controls'), 2000);
      }
    };

    const hideControls = () => {
      clearTimeout(hideControlsTimer);
      tile.classList.remove('show-controls');
    };

    tile.addEventListener('pointermove', revealControls);
    tile.addEventListener('pointerleave', hideControls);

    // Touch has no hover, so a tap on the tile itself reveals them.
    tile.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input')) return;
      revealControls();
    });

    storyVideo.addEventListener('play', () => {
      setIcon(true);
      setAudioIcon();
      tile.classList.add('is-playing');
      hideControls(); // fade immediately, even though the pointer is still here
    });

    storyVideo.addEventListener('pause', () => {
      setIcon(false);
      tile.classList.remove('is-playing');
      hideControls();
    });

    // If the video will not load, fall back to the still rather than a blank tile.
    storyVideo.addEventListener('error', () => {
      storyVideo.hidden = true;
      storyImage.hidden = false;
      playButton.hidden = true;
      if (audioWrap) audioWrap.hidden = true;
      if (progress) progress.hidden = true;
      tile.classList.remove('is-playing');
    });
  }
}

// --- Sticky call to action ------------------------------------------------
// Visible only in the middle of the page: after the intro has scrolled away, and
// not once the reader has reached the last section.
const stickyCta = document.querySelector('#sticky-cta');
const intro = document.querySelector('#intro');
const lastSection = document.querySelector('#last-section');

if (stickyCta && intro && lastSection && 'IntersectionObserver' in window) {
  const ctaButton = stickyCta.querySelector('.sticky-cta-button');
  let pastIntro = false;
  let atLastSection = false;

  const updateCta = () => {
    const visible = pastIntro && !atLastSection;
    stickyCta.classList.toggle('is-visible', visible);
    stickyCta.setAttribute('aria-hidden', String(!visible));
    // Keep it out of the tab order while it is off-screen.
    ctaButton.tabIndex = visible ? 0 : -1;
  };

  new IntersectionObserver(([entry]) => {
    pastIntro = !entry.isIntersecting;
    updateCta();
  }).observe(intro);

  new IntersectionObserver(([entry]) => {
    atLastSection = entry.isIntersecting;
    updateCta();
  }).observe(lastSection);
}

// Firefox has no -webkit-user-drag, so cancel the drag itself. Delegated from the
// document, which also covers images added later (the story swap, for one).
document.addEventListener('dragstart', (e) => {
  if (e.target.tagName === 'IMG') e.preventDefault();
});

const track = document.querySelector('.image-slider-track');
const slides = document.querySelectorAll('.image-slider-section');
const prevButton = document.querySelector('.slider-arrow-prev');
const nextButton = document.querySelector('.slider-arrow-next');
const slider = document.querySelector('.image-slider');

let currentIndex = 0;

function goToSlide(index) {
  currentIndex = (index + slides.length) % slides.length;
  track.style.transform = `translateX(-${currentIndex * 100}%)`;
}

if (track && slides.length && prevButton && nextButton) {
  prevButton.addEventListener('click', () => goToSlide(currentIndex - 1));
  nextButton.addEventListener('click', () => goToSlide(currentIndex + 1));

  slider.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') goToSlide(currentIndex - 1);
    if (e.key === 'ArrowRight') goToSlide(currentIndex + 1);
  });
}
