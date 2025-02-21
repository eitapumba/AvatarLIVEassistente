"use client";
import AvatarInteraction from "@/app/AvatarInteraction";
import DottedFace from "@/app/components/DottedFace";
import React, { useState } from "react";
import { Toaster } from "react-hot-toast";

// Update the Avatar interface
interface Avatar {
  name: string;
  simli_faceid: string;
  initialPrompt: string;
}

// Avatar data
const avatar: Avatar = {
  name: "Fernando",
  simli_faceid: "e99c1a3c-a6c9-4446-8ae4-c529e5d2423c",
  initialPrompt:
    "Você é o Fernando, um assistente virtual amigável e profissional. Você deve sempre responder em português do Brasil de forma clara e objetiva. Mantenha um tom conversacional mas profissional. Você deve ser prestativo e tentar ajudar o usuário da melhor forma possível.",
};

const Demo: React.FC = () => {
  const [showDottedFace, setShowDottedFace] = useState(true);

  const onStart = () => {
    console.log("Setting setshowDottedface to false...");
    setShowDottedFace(false);
  };

  return (
    <>
      <Toaster />
      <div className="bg-black min-h-screen relative">
        <div className="fixed bottom-4 right-4 flex flex-col items-center">
          {showDottedFace && <DottedFace />}
          <AvatarInteraction
            simli_faceid={avatar.simli_faceid}
            initialPrompt={avatar.initialPrompt}
            onStart={onStart}
            showDottedFace={showDottedFace}
          />
        </div>
      </div>
    </>
  );
};

export default Demo;
