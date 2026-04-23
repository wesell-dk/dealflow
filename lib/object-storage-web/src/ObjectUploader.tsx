import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Uppy from "@uppy/core";
import type { UppyFile, UploadResult } from "@uppy/core";
import DashboardModal from "@uppy/react/dashboard-modal";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import AwsS3 from "@uppy/aws-s3";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  onGetUploadParameters: (
    file: UppyFile<Record<string, unknown>, Record<string, unknown>>,
  ) => Promise<{ method: "PUT"; url: string; headers?: Record<string, string> }>;
  onComplete?: (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>,
  ) => void;
  buttonClassName?: string;
  children: ReactNode;
}

export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760,
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  children,
}: ObjectUploaderProps) {
  const onCompleteRef = useRef(onComplete);
  const onGetUploadParametersRef = useRef(onGetUploadParameters);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  useEffect(() => { onGetUploadParametersRef.current = onGetUploadParameters; }, [onGetUploadParameters]);

  const [showModal, setShowModal] = useState(false);
  const [uppy] = useState(() =>
    new Uppy({
      restrictions: { maxNumberOfFiles, maxFileSize },
      autoProceed: false,
    })
      .use(AwsS3, {
        shouldUseMultipart: false,
        getUploadParameters: (file) => onGetUploadParametersRef.current(file),
      })
      .on("complete", (result) => {
        onCompleteRef.current?.(result);
      }),
  );

  return (
    <div>
      <button onClick={() => setShowModal(true)} className={buttonClassName}>
        {children}
      </button>
      <DashboardModal
        uppy={uppy}
        open={showModal}
        onRequestClose={() => setShowModal(false)}
        proudlyDisplayPoweredByUppy={false}
      />
    </div>
  );
}
