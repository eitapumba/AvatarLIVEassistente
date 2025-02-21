import { RefObject } from 'react';

interface VideoBoxProps {
  video: RefObject<HTMLVideoElement>;
  audio: RefObject<HTMLAudioElement>;
}

export default function VideoBox({ video, audio }: VideoBoxProps) {
  return (
    <div className="aspect-video flex items-center h-[280px] w-[280px] justify-center bg-simligray rounded-lg overflow-hidden">
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