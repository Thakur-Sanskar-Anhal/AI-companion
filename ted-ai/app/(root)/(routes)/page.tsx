import { UserButton } from "@clerk/nextjs";

const RootPage = () => {
    return ( 
        <div>
            <UserButton afterSignOutUrl="/"/>
            Root Page (Protected)
        </div>
     );
}
 
export default RootPage;