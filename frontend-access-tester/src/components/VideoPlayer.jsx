import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import videojs from "video.js";

function VideoPlayer({ src }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);

  useEffect(() => {
    if (!videoRef.current) return;
    if (!playerRef.current) {
      playerRef.current = videojs(videoRef.current, {
        controls: true,
        preload: "auto",
        fluid: true,
      });
    }
    const player = playerRef.current;
    player.src({ src, type: "application/x-mpegURL" });
    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [src]);

  return (
    <div>
      <video
        ref={videoRef}
        className="video-js vjs-default-skin"
        playsInline
        controls
      >
        <track kind="captions" src="" label="English captions" />
      </video>
    </div>
  );
}

VideoPlayer.propTypes = {
  src: PropTypes.string.isRequired,
};

export default VideoPlayer;
