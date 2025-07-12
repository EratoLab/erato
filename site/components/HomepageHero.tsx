import Link from "next/link";

export default () => (
  <div className="flex flex-col md:flex-row max-w-[60rem] mx-auto px-6 py-10">
    <div className="w-3/5">
      <div className="text-8xl font-black">Erato</div>
      <div className="text-lg max-w-[30rem] pt-2">
        The AI Chat built for on-premise
        <br /> and fit for your organizations needs.
      </div>
    </div>
    <div className="flex flex-col mt-4 md:mt-0 gap-4 justify-center font-bold text-center">
      <Link href="/docs" className="p-2 px-12 rounded-sm bg-f33-green-500">
        GET STARTED
      </Link>
    </div>
  </div>
);
