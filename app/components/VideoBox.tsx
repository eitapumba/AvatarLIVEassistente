import { RefObject } from 'react';

interface VideoBoxProps {
  video: RefObject<HTMLVideoElement>;
  audio: RefObject<HTMLAudioElement>;
}

export default function VideoBox({ video, audio }: VideoBoxProps) {
  return (
    <div className="aspect-video flex items-center h-[350px] w-[350px] justify-center bg-simligray">
      <video 
        ref={video}
        autoPlay 
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
      <audio 
        ref={audio}
        autoPlay
        style={{ display: 'none' }}
      />
    </div>
  );
}